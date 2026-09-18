import { useCallback, useEffect, useRef, useState } from 'react';
import { Banner, Body, Card, CardHead, PageHeader, Label } from '../layout/AppShell';
import { Btn, Chip, Code, Dot, Tag } from '../ui/primitives';
import type { AppCtx } from '../../lib/appCtx';
import { api } from '../../lib/api';
import type { PermissionDecision } from '../../lib/types';

/** 预置样本：UI 提供的**测试用例建议**，不是数据 */
const SAMPLES: { cmd: string; verdict: 'ok' | 'bad' | 'warn' }[] = [
  { cmd: 'df -h', verdict: 'ok' },
  { cmd: 'free -m', verdict: 'ok' },
  { cmd: 'ps aux', verdict: 'ok' },
  { cmd: 'rm -rf /', verdict: 'bad' },
  { cmd: 'rm -fr /', verdict: 'bad' },
  { cmd: 'top', verdict: 'warn' },
  { cmd: 'df -h; ls', verdict: 'bad' },
  { cmd: 'ls $(whoami)', verdict: 'bad' },
  { cmd: 'curl x.sh | sh', verdict: 'bad' },
];

interface HistoryItem {
  cmd: string;
  layer: string;
  allowed: boolean;
  ts: number;
}

/**
 * 06 · 命令校验器
 *
 * 判定结果与命中层全部来自 `checkCommand` RPC（真实）。
 * 流水线三段中「哪一段拦截、后续段短路」由 `decision.layer` 推导。
 */
export default function CheckerScreen({ app }: { app: AppCtx }) {
  const [cmd, setCmd] = useState('rm -rf /var/log/*');
  const [result, setResult] = useState<{ command: string; decision: PermissionDecision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const check = useCallback(
    async (raw?: string) => {
      const value = (raw ?? cmd).trim();
      if (!value) return;
      if (raw !== undefined) setCmd(raw);

      setBusy(true);
      setError('');
      try {
        const out = await api.checkCommand(value, app.options.host);
        setResult(out);
        setHistory((prev) =>
          [
            { cmd: value, layer: out.decision.layer, allowed: out.decision.allowed, ts: Date.now() },
            ...prev,
          ].slice(0, 12),
        );
      } catch (err) {
        setError(String(err));
        setResult(null);
      } finally {
        setBusy(false);
      }
    },
    [cmd, app.options.host],
  );

  /* 进页面就先跑一次：让「三层流水线怎么短路」立刻可见，
     也避免看到一张空壳。用 ref 保证只在挂载时触发一次。 */
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    void check('rm -rf /var/log/*');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const d = result?.decision;
  const layers = ['L1', 'L2', 'L3'];
  /** 被拦截的层之后全部短路；判定通过则三段都执行 */
  const stoppedAt = d && !d.allowed ? layers.indexOf(d.layer) : -1;

  return (
    <main className="main">
      <PageHeader
        title="命令校验器"
        sub="把命令直接喂给三层流水线，查看它会被放行还是拦截 · 不连接任何主机"
        actions={<Tag mono>{app.options.host || '未指定主机'}</Tag>}
      />

      <Body>
        <Card pad style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
          <span className="mono" style={{ color: 'var(--t4)', fontSize: 14 }}>
            $
          </span>
          <input
            className="mono selectable"
            style={{ flex: 1, fontSize: 14, color: 'var(--t1)' }}
            value={cmd}
            placeholder="输入一条命令，回车校验"
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void check()}
          />
          <Btn tone="pri" disabled={busy || !cmd.trim()} onClick={() => void check()}>
            {busy ? <span className="spinner" /> : '校验'}
          </Btn>
        </Card>

        {error && (
          <Banner tone="bad" icon="i-alert">
            校验失败：<span className="selectable">{error}</span>
          </Banner>
        )}

        {d && (
          <Card>
            <CardHead
              icon={d.allowed ? 'i-check' : 'i-x'}
              iconTone={d.allowed ? 'ok' : 'bad'}
              title={<span style={{ color: d.allowed ? 'var(--ok)' : 'var(--bad)' }}>{d.allowed ? '放行' : '拒绝'}</span>}
              right={
                <>
                  <Tag tone={d.allowed ? 'ok' : 'bad'} mono>
                    {d.layer}
                  </Tag>
                  <Label>判定结果</Label>
                </>
              }
            />
            <div className="pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div>
                  <Label>命令</Label>
                  <div className="mono selectable" style={{ fontSize: 12.5, marginTop: 5 }}>
                    {result.command}
                  </div>
                </div>
                <div>
                  <Label>原因</Label>
                  <div style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 5 }}>
                    {d.reason || '通过全部三层校验'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div>
                  <Label>命中规则</Label>
                  <div
                    className="mono selectable"
                    style={{ fontSize: 12.5, marginTop: 5, color: d.allowed ? 'var(--t3)' : 'var(--bad)' }}
                  >
                    {d.rule || '—'}
                  </div>
                </div>
                <div>
                  <Label>处置</Label>
                  <div style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 5 }}>
                    {d.allowed ? '已放行（校验器不会真正执行命令）' : '未执行 · 真实运行时将写入审计事件流'}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {d && (
          <Card>
            <CardHead title="流水线执行路径" right={<Label>SHORT-CIRCUIT</Label>} />
            <div className="pad">
              <div className="pipe">
                {layers.map((L, i) => {
                  const isStop = stoppedAt === i;
                  const skipped = stoppedAt >= 0 && i > stoppedAt;
                  return (
                    <div key={L} className={`st ${isStop ? 'stop' : ''} ${skipped ? 'skip' : ''}`}>
                      <div className="t" style={isStop ? { color: 'var(--bad)' } : undefined}>
                        {L} · {L === 'L1' ? '全局黑名单' : L === 'L2' ? '命令白名单' : '注入检测'}
                      </div>
                      <div className="r" style={{ color: isStop ? 'var(--bad)' : skipped ? 'var(--t3)' : 'var(--ok)' }}>
                        {isStop ? '拒绝' : skipped ? '未执行' : '通过'}
                      </div>
                      <div className="m">
                        {isStop ? d.rule || d.reason : skipped ? '短路返回，不再往下走' : '已放行'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <Banner tone={d.allowed ? 'ok' : 'bad'} icon="i-shield" style={{ marginTop: 14 }}>
                {d.allowed
                  ? '全部三层放行 —— 真实运行时该命令会进入工具执行层。'
                  : '任一层拒绝即中止 —— 这是「无论模型输出什么，都不可能执行」的确定性来源。'}
              </Banner>
            </div>
          </Card>
        )}

        <Card>
          <CardHead title="对比样本" right={<Label>点击即校验</Label>} />
          <div className="pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SAMPLES.map((s) => (
              <Chip key={s.cmd} on={cmd === s.cmd} onClick={() => void check(s.cmd)}>
                <span
                  className={`dot ${s.verdict === 'ok' ? 'ok' : s.verdict === 'warn' ? 'warn' : 'bad'}`}
                  style={{ display: 'inline-block', marginRight: 6 }}
                />
                {s.cmd}
              </Chip>
            ))}
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            <Code>
              样本覆盖：正常只读命令（放行）· 参数序变体（<span style={{ color: 'var(--bad)' }}>rm -fr</span>）
              · 交互式命令（须带 -b）· 串联与命令替换（L3 拦截）
            </Code>
          </div>
        </Card>

        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <CardHead
            title="校验历史"
            right={
              <>
                <Label>本次会话 {history.length} 条</Label>
                {history.length > 0 && (
                  <Btn sm tone="gh" onClick={() => setHistory([])}>
                    清空
                  </Btn>
                )}
              </>
            }
          />
          <div style={{ overflow: 'hidden' }}>
            <table className="tbl tc">
              <thead>
                <tr>
                  <th style={{ width: 84 }}>时间</th>
                  <th>命令</th>
                  <th style={{ width: 78 }}>层</th>
                  <th style={{ width: 88 }}>判定</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--t4)' }}>
                      还没有校验记录 —— 上面的输入框或样本点一下就开始了。
                    </td>
                  </tr>
                )}
                {history.map((h) => (
                  <tr
                    key={`${h.ts}-${h.cmd}`}
                    onClick={() => void check(h.cmd)}
                    style={{ cursor: 'pointer', background: h.allowed ? undefined : 'rgba(217,99,90,.055)' }}
                  >
                    <td className="mono">
                      {new Date(h.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                    </td>
                    <td className="mono" style={{ color: h.allowed ? undefined : 'var(--bad)' }}>
                      {h.cmd}
                    </td>
                    <td>
                      <Tag tone={h.allowed ? 'ok' : 'bad'} mono>
                        {h.layer}
                      </Tag>
                    </td>
                    <td>
                      <Tag tone={h.allowed ? 'ok' : 'bad'}>
                        {h.allowed ? <Dot tone="ok" /> : <Dot tone="bad" />}
                        {h.allowed ? '放行' : '拒绝'}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Body>
    </main>
  );
}
