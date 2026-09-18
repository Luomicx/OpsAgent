import { useMemo } from 'react';
import Icon from '../ui/Icon';
import { CardHead, PageHeader, Rail } from '../layout/AppShell';
import { Bar, Btn, Chip, Tag } from '../ui/primitives';
import type { IconId } from '../ui/IconSprite';
import type { AppCtx } from '../../lib/appCtx';
import type { TimelineKind } from '../../lib/types';

/** 语义分类 → 图标 / 颜色 / 事件块底色 */
function evVisual(kind: TimelineKind): { icon: IconId; color: string; bg: string; cls: string } {
  switch (kind) {
    case 'denied':
      return { icon: 'i-x', color: 'var(--bad)', bg: 'var(--bad-bg)', cls: 'bad' };
    case 'allowed':
      return { icon: 'i-check', color: 'var(--ok)', bg: 'var(--ok-bg)', cls: 'good' };
    case 'final':
      return { icon: 'i-check', color: 'var(--ac)', bg: 'var(--ac-bg)', cls: 'fin' };
    case 'error':
      return { icon: 'i-alert', color: 'var(--bad)', bg: 'var(--bad-bg)', cls: 'bad' };
    case 'input':
      return { icon: 'i-arrow-dn', color: 'var(--ac)', bg: 'var(--ac-bg)', cls: '' };
    case 'think':
      return { icon: 'i-pulse', color: 'var(--t3)', bg: 'rgba(255,255,255,.05)', cls: '' };
    case 'tool':
      return { icon: 'i-terminal', color: 'var(--t2)', bg: 'rgba(255,255,255,.05)', cls: '' };
    default:
      return { icon: 'i-sparkle', color: 'var(--t3)', bg: 'rgba(255,255,255,.05)', cls: '' };
  }
}

const hhmmss = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour12: false });

/** 建议指令 —— 这是 UI 提供的**输入建议**，不是数据 */
const SUGGESTIONS = [
  '看看这台机器磁盘和内存使用情况',
  '检查最近的系统错误日志',
  '列出 /var/log 下最大的文件',
  '确认 nginx 服务运行状态',
];

/**
 * 03 · 执行时间线（核心屏）
 *
 * 归约逻辑完全复用 `lib/timeline.ts` —— 本屏只做视觉。
 */
export default function TimelineScreen({ app }: { app: AppCtx }) {
  const { entries, expanded, toggleEntry, result, busy, runError, conn, status, options, prompt, setPrompt, run, cancel } = app;

  const ready = conn === 'ready';

  /* 会话统计：全部由事件流 + AgentResult 推导，无编造 */
  const stat = useMemo(() => {
    const tools = entries.filter((e) => e.kind === 'tool').length;
    const denied = entries.filter((e) => e.eventType === 'permission.denied').length;
    const first = entries[0]?.ts;
    const last = entries[entries.length - 1]?.ts;
    const elapsed = first && last ? last - first : 0;
    const stepsUsed = result?.stepsUsed ?? entries.filter((e) => e.kind === 'think').length;
    const maxSteps = 8;
    return { tools, denied, elapsed, stepsUsed, maxSteps, pct: Math.round((stepsUsed / maxSteps) * 100) };
  }, [entries, result]);

  return (
    <>
      <main className="main">
        <PageHeader
          title="执行时间线"
          sub={
            <>
              主机 <span className="mono" style={{ color: 'var(--t2)' }}>{options.host || '—'}</span> · 适配器{' '}
              <span className="mono" style={{ color: 'var(--t2)' }}>{status?.adapter ?? '—'}</span>
            </>
          }
          actions={
            <>
              <Chip on>全部事件</Chip>
              <Chip>仅拦截</Chip>
              <Btn tone="dg" icon="i-x" disabled={!busy} onClick={() => void cancel()}>
                取消
              </Btn>
            </>
          }
        />

        {runError && (
          <div style={{ padding: '0 24px 12px' }}>
            <div className="bnr bad">
              <Icon name="i-alert" size="s" />
              <span className="selectable">{runError}</span>
            </div>
          </div>
        )}

        <div className="tl">
          {entries.length === 0 ? (
            <div style={{ color: 'var(--t4)', fontSize: 12.5, padding: '20px 11px' }}>
              暂无事件。在下方输入一条只读诊断指令开始。
            </div>
          ) : (
            entries.map((e) => {
              const v = evVisual(e.kind);
              const open = expanded.has(e.id);
              return (
                <div key={e.id} className={`ev ${v.cls}`}>
                  <div className="rl">
                    <span className="ico" style={{ color: v.color, background: v.bg }}>
                      <Icon name={v.icon} size="s" />
                    </span>
                    <span className="ln" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="hh">
                      <span className="tt">{e.title}</span>
                      {e.seq !== undefined && <span className="sq">#{e.seq}</span>}
                      <span className="tm">{hhmmss(e.ts)}</span>
                    </div>
                    {e.detail && <div className="dd">{e.detail}</div>}
                    {open && e.body && <div className="code selectable">{e.body}</div>}
                    {e.body && (
                      <button
                        className="btn gh sm"
                        style={{ marginTop: 7 }}
                        onClick={() => toggleEntry(e.id)}
                      >
                        <Icon name={open ? 'i-chev-d' : 'i-chev-r'} size="s" />
                        {open ? '收起输出' : `展开输出（${e.body.length} 字）`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="composer">
          <textarea
            className="ta"
            value={prompt}
            placeholder="下达一条只读诊断指令，例如：看看这台机器磁盘和内存使用情况"
            disabled={busy || !ready}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void run();
              }
            }}
          />
          <Btn
            tone="pri"
            icon={busy ? undefined : 'i-arrow-up'}
            disabled={!prompt.trim() || busy || !ready}
            onClick={() => void run()}
            style={{ height: 42, padding: '0 18px' }}
          >
            {busy ? <span className="spinner" /> : '发送'}
          </Btn>
        </div>
      </main>

      {/* ------------------------------ 右栏 ------------------------------ */}
      <Rail>
        <CardHead title="会话信息" right={<Tag tone="ac" mono>{options.host || '—'}</Tag>} />
        <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Stat label="步数" value={`${stat.stepsUsed} / ${stat.maxSteps}`} />
            <Stat label="耗时" value={`${stat.elapsed.toFixed(1)}s`} />
            <Stat label="工具调用" value={String(stat.tools)} />
            <Stat label="拦截" value={String(stat.denied)} color="var(--bad)" />
          </div>
          <Bar pct={stat.pct} />
          <div style={{ fontSize: 11, color: 'var(--t3)' }}>
            已用步数占比 {stat.pct}%
          </div>
        </div>

        <CardHead title="建议指令" right={<span className="lbl">SUGGEST</span>} />
        <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {SUGGESTIONS.map((s) => (
            <Chip key={s} onClick={() => setPrompt(s)} style={{ textAlign: 'left' }}>
              {s}
            </Chip>
          ))}
        </div>

        <CardHead
          title="事件流"
          right={<Tag mono>共 {status?.eventCount ?? entries.length} 条</Tag>}
        />
        <div className="pad evstream">
          {entries.length === 0 ? (
            <div style={{ color: 'var(--t4)' }}>—</div>
          ) : (
            entries.slice(-9).map((e) => (
              <div key={e.id}>
                <span className="sq">{String(e.seq ?? 0).padStart(4, '0')}</span>{' '}
                <span style={{ color: e.kind === 'denied' ? 'var(--bad)' : e.kind === 'allowed' ? 'var(--ok)' : undefined }}>
                  {e.eventType}
                </span>
              </div>
            ))
          )}
        </div>

        <CardHead title="会话操作" />
        <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '12px 14px 14px' }}>
          <Btn icon="i-eye" disabled={!result} onClick={() => app.go('report')} style={{ justifyContent: 'flex-start' }}>
            查看完整报告
          </Btn>
          <Btn icon="i-list" onClick={() => app.go('audit')} style={{ justifyContent: 'flex-start' }}>
            查看事件审计
          </Btn>
          <Btn icon="i-terminal-2" onClick={() => app.go('checker')} style={{ justifyContent: 'flex-start' }}>
            校验一条命令
          </Btn>
        </div>
      </Rail>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="lbl">{label}</div>
      <div className="mono" style={{ fontSize: 17, fontWeight: 600, marginTop: 4, color }}>
        {value}
      </div>
    </div>
  );
}
