import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../ui/Icon';
import { Banner, Body, Card, CardHead, PageHeader } from '../layout/AppShell';
import { Bar, Btn, Chip, Kpi, Tag, Empty } from '../ui/primitives';
import type { AppCtx } from '../../lib/appCtx';
import { api } from '../../lib/api';
import type { SessionEvent } from '../../lib/types';

/** 事件类型 → 语义色（与设计稿的配色一致） */
function typeTone(type: string): 'ok' | 'bad' | 'ac' | 'pur' | 'mut' {
  if (type.startsWith('permission.denied')) return 'bad';
  if (type.startsWith('permission.')) return 'ok';
  if (type.startsWith('agent.')) return 'ac';
  if (type.startsWith('context.')) return 'pur';
  return 'mut';
}

const REPLAY_SPEEDS = [1, 2, 4];

/**
 * 07 · 事件流审计
 *
 * 全部数据来自 `replay` RPC（真实）：事件数组 + seq 完整性校验。
 * 回放控制是前端行为，逐条推进而非一次性展示。
 */
export default function AuditScreen({ app }: { app: AppCtx }) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [path, setPath] = useState('');
  const [integrity, setIntegrity] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /* 回放 */
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [filter, setFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const out = await api.replay();
      setEvents(out.events);
      setPath(out.path);
      setIntegrity(out.integrity);
      setReplayAt(null);
    } catch (err) {
      setError(String(err));
      setEvents([]);
      setIntegrity(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* 回放推进 */
  useEffect(() => {
    if (replayAt === null || replayAt >= events.length) return;
    const t = setTimeout(() => setReplayAt((n) => (n === null ? null : n + 1)), 420 / speed);
    return () => clearTimeout(t);
  }, [replayAt, events.length, speed]);

  const stats = useMemo(() => {
    const types = new Set(events.map((e) => e.type));
    const denied = events.filter((e) => e.type === 'permission.denied').length;
    return { types: types.size, denied };
  }, [events]);

  const visible = useMemo(() => {
    let list = events;
    if (replayAt !== null) list = list.slice(0, replayAt);
    if (filter !== 'all') list = list.filter((e) => e.type.startsWith(filter));
    return list.slice(-200).reverse();
  }, [events, replayAt, filter]);

  const pct = events.length > 0 ? ((replayAt ?? events.length) / events.length) * 100 : 0;

  return (
    <main className="main">
      <PageHeader
        title="事件审计"
        sub={
          path
            ? `append-only JSONL · ${events.length} 条事件 · ${path}`
            : 'append-only JSONL · 可校验完整性、可回放'
        }
        actions={
          <>
            <Btn icon="i-refresh" onClick={() => void load()} disabled={loading}>
              {loading ? '读取中…' : '重新读取'}
            </Btn>
            <Btn icon="i-download" disabled title="Phase 4 提供导出能力">
              导出 JSONL
            </Btn>
          </>
        }
      />

      <Body>
        {error && (
          <Banner tone="bad" icon="i-alert">
            读取事件流失败：<span className="selectable">{error}</span>
          </Banner>
        )}

        <div className="kpis">
          <Kpi compact label="事件总数" value={events.length} />
          <Kpi compact label="事件类型" value={stats.types} unit=" / 14" />
          <Kpi
            compact
            label="拦截事件"
            value={stats.denied}
            valueColor={stats.denied > 0 ? 'var(--bad)' : undefined}
          />
          <Kpi
            compact
            label="完整性"
            value={integrity === null ? '—' : integrity ? '通过' : '异常'}
            valueColor={integrity === null ? undefined : integrity ? 'var(--ok)' : 'var(--bad)'}
          />
        </div>

        {integrity === false && (
          <Banner tone="bad" icon="i-alert">
            <b>完整性校验未通过</b>：seq 不是从 1 开始严格递增，事件流可能被改写或丢写。
          </Banner>
        )}

        <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CardHead
            title="事件流"
            right={
              <>
                <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
                  全部
                </Chip>
                <Chip on={filter === 'tool.'} onClick={() => setFilter('tool.')}>
                  tool.*
                </Chip>
                <Chip on={filter === 'permission.'} onClick={() => setFilter('permission.')}>
                  permission.*
                </Chip>
                <Chip on={filter === 'agent.'} onClick={() => setFilter('agent.')}>
                  agent.*
                </Chip>
              </>
            }
          />
          <div style={{ overflow: 'auto', flex: 1 }}>
            {visible.length === 0 ? (
              <div style={{ padding: 20 }}>
                <Empty
                  icon="i-list"
                  title="没有可展示的事件"
                  desc="当前筛选条件下没有事件。如果还没跑过诊断，事件流是空的。"
                  actions={
                    <Btn tone="pri" icon="i-terminal" onClick={() => app.go('run')}>
                      去执行一次诊断
                    </Btn>
                  }
                />
              </div>
            ) : (
              <table className="tbl tc">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>SEQ</th>
                    <th style={{ width: 92 }}>时间</th>
                    <th style={{ width: 190 }}>事件类型</th>
                    <th>data（已脱敏）</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr
                      key={e.seq}
                      style={e.type === 'permission.denied' ? { background: 'rgba(217,99,90,.055)' } : undefined}
                    >
                      <td className="mono" style={{ color: 'var(--t4)' }}>
                        {String(e.seq).padStart(4, '0')}
                      </td>
                      <td className="mono">
                        {new Date(e.ts * 1000).toLocaleTimeString('zh-CN', { hour12: false })}
                      </td>
                      <td>
                        <Tag tone={typeTone(e.type)} mono>
                          {e.type}
                        </Tag>
                      </td>
                      <td
                        className="mono selectable"
                        style={{
                          maxWidth: 520,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: e.type === 'permission.denied' ? 'var(--bad)' : undefined,
                        }}
                        title={JSON.stringify(e.data)}
                      >
                        {JSON.stringify(e.data)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* ---- 回放控制条 ---- */}
        <Card pad style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Btn
            tone="pri"
            disabled={events.length === 0}
            onClick={() => setReplayAt((n) => (n === null ? 0 : n >= events.length ? 0 : n + 1))}
            style={{ width: 34, height: 34, padding: 0 }}
            icon={replayAt === null ? 'i-play' : 'i-pause'}
          />
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--t3)' }}>
            {String(replayAt ?? events.length).padStart(4, '0')} / {String(events.length).padStart(4, '0')}
          </span>
          <Bar pct={pct} style={{ flex: 1, height: 6 }} />
          {REPLAY_SPEEDS.map((s) => (
            <Chip key={s} on={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </Chip>
          ))}
          <Btn sm tone="gh" icon="i-refresh" onClick={() => setReplayAt(null)} disabled={replayAt === null}>
            显示全部
          </Btn>
        </Card>
      </Body>
    </main>
  );
}

export { Icon };
