import { useMemo } from 'react';
import Icon from '../ui/Icon';
import { Banner, Body, Card, CardHead, PageHeader } from '../layout/AppShell';
import { Btn, Kpi, Tag, Empty } from '../ui/primitives';
import type { AppCtx } from '../../lib/appCtx';

/**
 * 04 · 会话详情 / 诊断报告
 *
 * 全部数据来自 `AgentResult` 与事件流（真实）。
 * 「耗时」由事件流首末时间戳推导（后端暂不单列该字段）。
 */
export default function ReportScreen({ app }: { app: AppCtx }) {
  const { result, entries, prompt, options, status, go } = app;

  const meta = useMemo(() => {
    const tools = entries.filter((e) => e.kind === 'tool').length;
    const first = entries[0]?.ts;
    const last = entries[entries.length - 1]?.ts;
    return {
      tools,
      elapsed: first && last ? last - first : 0,
      events: entries.length,
    };
  }, [entries]);

  if (!result) {
    return (
      <main className="main">
        <PageHeader
          title="会话记录"
          sub="单次诊断的完整留痕"
          leading={
            <Btn tone="gh" icon="i-chev-l" onClick={() => go('run')} style={{ height: 30 }}>
              返回
            </Btn>
          }
        />
        <Body>
          <Empty
            icon="i-database"
            title="还没有可查看的会话"
            desc="去「执行」页跑一次只读诊断，这里会展示完整的结论、步骤留痕与拦截记录。"
            actions={
              <Btn tone="pri" icon="i-terminal" onClick={() => go('run')}>
                去执行
              </Btn>
            }
          />
        </Body>
      </main>
    );
  }

  const deniedSteps = result.steps.filter((s) => s.denied);

  return (
    <main className="main">
      <PageHeader
        title={prompt || '诊断会话'}
        sub={
          <>
            {options.host || '—'} · 适配器 <span className="mono">{status?.adapter ?? '—'}</span> · 耗时{' '}
            <span className="mono">{meta.elapsed.toFixed(1)}s</span> · 事件 {meta.events} 条
          </>
        }
        leading={
          <Btn tone="gh" icon="i-chev-l" onClick={() => go('run')} style={{ height: 30 }}>
            返回
          </Btn>
        }
        actions={
          <>
            <Tag tone={result.finished ? 'ok' : 'warn'}>
              {result.finished ? '已完成' : '达到最大步数'}
            </Tag>
            <Btn icon="i-list" onClick={() => go('audit')}>
              事件审计
            </Btn>
            <Btn icon="i-refresh" onClick={() => void app.run()} disabled={app.busy}>
              重跑
            </Btn>
          </>
        }
      />

      <Body>
        <Card>
          <CardHead
            icon="i-check"
            iconTone="ac"
            title="结论"
            right={<span className="lbl">AGENT FINAL</span>}
          />
          <div
            className="pad selectable"
            style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--t1)', whiteSpace: 'pre-wrap' }}
          >
            {result.text || '（模型未返回文本结论）'}
          </div>
        </Card>

        <div className="kpis">
          <Kpi compact label="推理步数" value={result.stepsUsed} unit=" / 8" />
          <Kpi compact label="工具调用" value={meta.tools} />
          <Kpi
            compact
            label="权限拦截"
            value={result.deniedCount}
            valueColor={result.deniedCount > 0 ? 'var(--bad)' : undefined}
          />
          <Kpi compact label="事件条数" value={meta.events} />
        </div>

        <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CardHead
            title="执行步骤留痕"
            right={
              <>
                <Tag mono>StepRecord</Tag>
                <span className="lbl">{result.steps.length} 条</span>
              </>
            }
          />
          <div style={{ overflow: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>步骤</th>
                  <th style={{ width: 150 }}>工具</th>
                  <th>命令</th>
                  <th style={{ width: 90 }}>权限层</th>
                  <th style={{ width: 110 }}>结果</th>
                  <th style={{ width: 88 }}>输出</th>
                </tr>
              </thead>
              <tbody>
                {result.steps.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--t4)' }}>
                      本次会话没有工具调用记录。
                    </td>
                  </tr>
                )}
                {result.steps.map((s, i) => (
                  <tr key={`${s.tool}-${i}`} style={s.denied ? { background: 'rgba(217,99,90,.055)' } : undefined}>
                    <td className="mono" style={{ color: 'var(--t4)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </td>
                    <td className="mono">{s.tool}</td>
                    <td className="mono selectable" style={{ color: s.denied ? 'var(--bad)' : undefined }}>
                      {s.command || (s.args && Object.keys(s.args).length > 0 ? JSON.stringify(s.args) : '—')}
                    </td>
                    <td>
                      <Tag tone={s.allowed ? 'ok' : 'bad'} mono>
                        {s.allowed ? 'ALL' : s.layer}
                      </Tag>
                    </td>
                    <td>
                      <Tag tone={s.allowed ? 'ok' : 'bad'}>{s.allowed ? '允许' : '拒绝'}</Tag>
                    </td>
                    <td className="mono" style={{ color: 'var(--t4)' }}>
                      {s.allowed ? `${s.outputLength} 字` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {deniedSteps.length > 0 && (
            <div style={{ margin: '14px 16px 16px' }}>
              {deniedSteps.map((s, i) => (
                <Banner key={i} tone="bad" icon="i-alert" style={i > 0 ? { marginTop: 8 } : undefined}>
                  <b>被拦截</b> · 命中层 <span className="mono">{s.layer}</span> ·{' '}
                  <span className="selectable">{s.reason || '未提供原因'}</span>
                  <br />
                  <span style={{ color: 'var(--t3)' }}>已写入审计事件流，未产生任何远程副作用。</span>
                </Banner>
              ))}
            </div>
          )}
        </Card>
      </Body>
    </main>
  );
}

export { Icon };
