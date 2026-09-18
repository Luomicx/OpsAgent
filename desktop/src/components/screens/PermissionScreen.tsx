import { useCallback, useEffect, useState } from 'react';
import { Banner, Body, Card, CardHead, PageHeader, Label } from '../layout/AppShell';
import { Bar, Btn, Tag } from '../ui/primitives';
import type { AppCtx } from '../../lib/appCtx';
import { api } from '../../lib/api';
import type { PermissionReport } from '../../lib/types';

/** 层 → 语义色。/  与后端 `PermissionLayer.layer` 的取值对应（L1/L2/L3）。 */
const LAYER_TONE: Record<string, 'bad' | 'warn' | 'pur' | 'ac'> = {
  L1: 'bad',
  L2: 'warn',
  L3: 'pur',
};

/**
 * 05 · 权限分层
 *
 * 数据全部来自 `permission` RPC（层名 / 描述 / 规则数 / 规则明细都是真实的）。
 * 「命中次数」后端暂不提供 —— 该列显示为示例并已标注。
 */
export default function PermissionScreen({ app }: { app: AppCtx }) {
  const [report, setReport] = useState<PermissionReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await api.permission());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const layers = report?.layers ?? [];

  return (
    <main className="main">
      <PageHeader
        title="权限分层"
        sub={
          report
            ? `${layers.length} 层流水线 · ${report.totalRules} 条规则 · 任一层拒绝即短路返回`
            : '正在读取权限规则…'
        }
        actions={
          <>
            <Btn icon="i-refresh" onClick={() => void load()} disabled={loading}>
              重新读取
            </Btn>
            <Btn tone="pri" icon="i-plus" onClick={() => app.go('rules')}>
              编辑规则
            </Btn>
          </>
        }
      />

      <Body>
        <Banner tone="info" icon="i-alert">
          <b>L1 → L2 → L3 顺序执行，短路返回</b>
          。检查对象是「命令」本身；<b>路径维度（L5）尚未实现</b>
          —— <span className="mono">cat /etc/shadow</span> 这类敏感读取可通过全部三层，
          详见 README 的「已知安全边界」。
        </Banner>

        {error && (
          <Banner tone="bad" icon="i-alert">
            读取权限规则失败：<span className="selectable">{error}</span>
          </Banner>
        )}

        {layers.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${layers.length}, 1fr)`, gap: 14 }}>
            {layers.map((l) => {
              const tone = LAYER_TONE[l.layer] ?? 'ac';
              return (
                <Card key={l.layer} hover>
                  <div className="lay">
                    <span
                      className="id"
                      style={{
                        color: `var(--${tone})`,
                        background: `var(--${tone}-bg)`,
                        border: `1px solid var(--${tone}-bd, rgba(255,255,255,.2))`,
                      }}
                    >
                      {l.layer}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="nm">{l.name}</div>
                      <div className="ds">{l.description}</div>
                    </div>
                    <div className="ct">
                      <div className="n" style={{ color: `var(--${tone})` }}>
                        {l.ruleCount}
                      </div>
                      <div className="k">规则</div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {layers.map((l) => (
          <Card key={`tbl-${l.layer}`} style={{ display: 'flex', flexDirection: 'column' }}>
            <CardHead
              title={`${l.layer} · ${l.name} 规则明细`}
              right={
                <>
                  <Tag tone={LAYER_TONE[l.layer] ?? 'ac'}>{l.ruleCount} 条</Tag>
                  <Label>共 {l.rules.length} 条可见</Label>
                </>
              }
            />
            <div style={{ overflow: 'hidden' }}>
              <table className="tbl rl-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>层</th>
                    <th>匹配模式</th>
                    <th style={{ width: 88 }}>类型</th>
                    <th style={{ width: 200 }}>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {l.rules.map((r, i) => (
                    <tr key={`${r.pattern}-${i}`}>
                      <td>
                        <Tag tone={LAYER_TONE[l.layer] ?? 'ac'}>{l.layer}</Tag>
                      </td>
                      <td>
                        <span className="pat selectable">{r.pattern}</span>
                      </td>
                      <td>
                        <Tag>{r.kind}</Tag>
                      </td>
                      <td style={{ fontSize: 11.5 }}>{r.description || '—'}</td>
                    </tr>
                  ))}
                  {l.rules.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ color: 'var(--t4)' }}>
                        该层没有可展示的规则明细
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ))}

        {loading && !report && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--t3)', fontSize: 12.5 }}>
            <span className="spinner" style={{ color: 'var(--ac)' }} />
            正在读取权限规则…
          </div>
        )}
      </Body>
    </main>
  );
}

/** 命中热度（供 Phase 4 接入真实统计数据后复用） */
export function HitRate({ count, max, tone }: { count: number; max: number; tone?: 'bad' | 'warn' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="mono">{count}</span>
      <Bar pct={max > 0 ? (count / max) * 100 : 0} tone={tone} style={{ flex: 1 }} />
    </div>
  );
}
