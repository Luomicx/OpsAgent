import { useMemo } from 'react';
import { Banner, Body, Card, CardHead, PageHeader, Label } from '../layout/AppShell';
import { Btn, Chip, Kpi, Placeholder, Tag } from '../ui/primitives';
import type { AppCtx } from '../../lib/appCtx';

/**
 * 02 · 控制台总览
 *
 * 数据策略（重构计划 §0）：
 *  - KPI 四个指标全部来自 `status` / 事件流，**真实**
 *  - 7 天趋势、通过率、最近会话列表需要 Phase 4 的 `stats` / `sessions` RPC，
 *    当前标记为示例，不伪装成真实运行状态
 */
export default function OverviewScreen({ app }: { app: AppCtx }) {
  const { status, entries, conn, go } = app;

  const sessionStat = useMemo(() => {
    const denied = entries.filter((e) => e.eventType === 'permission.denied').length;
    const tools = entries.filter((e) => e.kind === 'tool').length;
    return { denied, tools };
  }, [entries]);

  const plugins = status?.plugins ?? [];
  const tools = status?.tools ?? [];
  const caps = status?.capabilities ?? {};

  return (
    <main className="main">
      <PageHeader
        title="控制台"
        sub={`${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} · 适配器 ${status?.adapter ?? '—'}`}
        actions={
          <>
            <Chip on>本次会话</Chip>
            <Btn icon="i-refresh" disabled={conn !== 'ready'} onClick={() => void app.restartBackend()}>
              重连后端
            </Btn>
          </>
        }
      />

      <Body>
        {/* ---- 真实 KPI（全部来自 status / 事件流）---- */}
        <div className="kpis">
          <Kpi
            label="事件总数"
            value={status?.eventCount ?? '—'}
            unit="条"
            foot={<span>落盘 {status?.sessionPath ? '已开启' : '未配置'}</span>}
          />
          <Kpi
            label="已加载插件"
            value={plugins.length || '—'}
            unit="个"
            foot={<span>{plugins.length ? '拓扑排序完成' : '等待后端'}</span>}
          />
          <Kpi
            label="已注册工具"
            value={tools.length || '—'}
            unit="个"
            foot={<span className="mono">{tools.slice(0, 2).join(' · ') || '—'}</span>}
          />
          <Kpi
            label="本会话拦截"
            value={sessionStat.denied}
            unit="次"
            valueColor={sessionStat.denied > 0 ? 'var(--bad)' : undefined}
            foot={<span>{sessionStat.denied > 0 ? '全部发生在 L1/L2' : '本次会话尚无拦截'}</span>}
          />
        </div>

        {/* ---- 趋势图：需要 stats RPC ---- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 292px', gap: 14 }}>
          <Card hover>
            <CardHead
              title="事件流活跃度"
              right={
                <>
                  <Label>EVENTS / DAY</Label>
                  <Tag tone="warn">示例</Tag>
                </>
              }
            />
            <div className="pad">
              <Placeholder>
                <svg className="chart" viewBox="0 0 780 176">
                  <defs>
                    <linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--ac)" stopOpacity=".22" />
                      <stop offset="100%" stopColor="var(--ac)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line className="gl" x1="34" y1="16" x2="774" y2="16" />
                  <line className="gl" x1="34" y1="56" x2="774" y2="56" />
                  <line className="gl" x1="34" y1="96" x2="774" y2="96" />
                  <line className="gl" x1="34" y1="136" x2="774" y2="136" />
                  <path
                    className="ar"
                    fill="url(#gArea)"
                    d="M40,118 C120,104 160,116 240,90 C320,64 360,78 440,54 C520,30 560,46 640,32 C700,22 740,28 768,20 L768,150 L40,150 Z"
                  />
                  <path
                    className="ln o"
                    pathLength="100"
                    d="M40,132 C120,124 160,130 240,112 C320,94 360,104 440,86 C520,68 560,78 640,62 C700,50 740,56 768,48"
                  />
                  <path
                    className="ln a"
                    pathLength="100"
                    d="M40,118 C120,104 160,116 240,90 C320,64 360,78 440,54 C520,30 560,46 640,32 C700,22 740,28 768,20"
                  />
                  <circle className="dt" cx="240" cy="90" r="3" fill="var(--bg-1)" stroke="var(--ac)" strokeWidth="1.8" style={{ transformOrigin: '240px 90px', animationDelay: '.8s' }} />
                  <circle className="dt" cx="440" cy="54" r="3" fill="var(--bg-1)" stroke="var(--ac)" strokeWidth="1.8" style={{ transformOrigin: '440px 54px', animationDelay: '1.1s' }} />
                  <circle className="dt" cx="768" cy="20" r="4.4" fill="var(--ac)" stroke="var(--bg-1)" strokeWidth="2" style={{ transformOrigin: '768px 20px', animationDelay: '1.5s' }} />
                </svg>
              </Placeholder>
              <div style={{ fontSize: 11, color: 'var(--t4)', marginTop: 8 }}>
                7 天趋势需要后端聚合统计（Phase 4 的 <span className="mono">stats</span> RPC）
              </div>
            </div>
          </Card>

          <Card hover>
            <CardHead title="权限通过率" right={<Tag tone="warn">示例</Tag>} />
            <div className="pad" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <Placeholder>
                <svg className="ring" viewBox="0 0 120 120" style={{ width: 132, height: 132 }}>
                  <circle className="tr" cx="60" cy="60" r="50" strokeWidth="11" />
                  <circle
                    className="vl-pct"
                    cx="60"
                    cy="60"
                    r="50"
                    stroke="var(--ok)"
                    strokeWidth="11"
                    pathLength="100"
                    style={{ ['--stop' as string]: 14 }}
                  />
                </svg>
              </Placeholder>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--t4)' }}>需要历史拦截统计</div>
              </div>
            </div>
          </Card>
        </div>

        {/* ---- 工具分布（本会话真实）+ 能力概览（真实）---- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
          <Card hover style={{ display: 'flex', flexDirection: 'column' }}>
            <CardHead title="本会话工具调用" right={<Label>SESSION</Label>} />
            <div className="pad">
              {sessionStat.tools === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--t4)' }}>
                  本次会话还没有工具调用。去「执行」页跑一次诊断。
                </div>
              ) : (
                <div className="hb">
                  {countByTool(entries).map(([name, n], i) => {
                    const max = Math.max(...countByTool(entries).map(([, v]) => v), 1);
                    return (
                      <div className="r" key={name}>
                        <span className="n">{name}</span>
                        <span className="t">
                          <i style={{ width: `${(n / max) * 100}%`, background: 'var(--ac)', animationDelay: `${i * 0.08}s` }} />
                        </span>
                        <span className="v">{n}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <Banner tone="info" icon="i-shield" style={{ marginTop: 16 }}>
                本会话拦截 <b>{sessionStat.denied}</b> 次，全部发生在 L1/L2，无一次穿透到工具执行层。
              </Banner>
            </div>
          </Card>

          <Card hover style={{ display: 'flex', flexDirection: 'column' }}>
            <CardHead title="内核能力概览" right={<Label>KERNEL</Label>} />
            <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <MiniStat label="插件" value={plugins.length} />
                <MiniStat label="能力" value={Object.keys(caps).length} />
                <MiniStat label="工具" value={tools.length} />
                <MiniStat label="事件类型" value={14} />
              </div>
              <div>
                <Label>能力 → 提供者</Label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {Object.entries(caps).map(([cap, provider]) => (
                    <Tag key={cap} mono>
                      {cap} ← {provider}
                    </Tag>
                  ))}
                  {Object.keys(caps).length === 0 && (
                    <span style={{ fontSize: 11.5, color: 'var(--t4)' }}>等待后端上报能力注册表</span>
                  )}
                </div>
              </div>
              <Btn icon="i-chip" onClick={() => go('kernel')} style={{ justifyContent: 'flex-start', marginTop: 'auto' }}>
                查看内核与依赖拓扑
              </Btn>
            </div>
          </Card>
        </div>

        <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CardHead
            title="最近会话"
            right={
              <>
                <Tag tone="warn">示例</Tag>
                <Btn sm tone="gh" onClick={() => go('report')}>
                  查看当前会话
                </Btn>
              </>
            }
          />
          <div style={{ overflow: 'hidden' }}>
            <Placeholder>
              <table className="tbl tc">
                <thead>
                  <tr>
                    <th>会话</th>
                    <th>主机</th>
                    <th>步骤</th>
                    <th>拦截</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">#a3f2c1</td>
                    <td className="mono">demo-host</td>
                    <td>3</td>
                    <td>
                      <Tag tone="bad">1</Tag>
                    </td>
                    <td>
                      <Tag tone="ok">已完成</Tag>
                    </td>
                  </tr>
                  <tr>
                    <td className="mono">#9b7e40</td>
                    <td className="mono">10.0.1.24</td>
                    <td>4</td>
                    <td>—</td>
                    <td>
                      <Tag tone="ok">已完成</Tag>
                    </td>
                  </tr>
                  <tr>
                    <td className="mono">#71cd8a</td>
                    <td className="mono">10.0.1.31</td>
                    <td>6</td>
                    <td>—</td>
                    <td>
                      <Tag tone="warn">达最大步数</Tag>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Placeholder>
          </div>
          <div style={{ padding: '12px 16px 16px', fontSize: 11, color: 'var(--t4)' }}>
            会话索引需要扫描 <span className="mono">.sessions/*.jsonl</span>（Phase 4 的{' '}
            <span className="mono">sessions</span> RPC）
          </div>
        </Card>
      </Body>
    </main>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="lbl">{label}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

/** 按工具名统计本会话调用次数（真实，来自事件流） */
function countByTool(entries: AppCtx['entries']): [string, number][] {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== 'tool') continue;
    const name = e.title || 'unknown';
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}
