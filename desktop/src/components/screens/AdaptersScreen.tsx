import { Banner, Body, Card, CardHead, Label, PageHeader } from '../layout/AppShell';
import { Btn, Code, Dot, Placeholder, Tag, Field } from '../ui/primitives';
import Icon from '../ui/Icon';
import type { AppCtx } from '../../lib/appCtx';

/**
 * 10 · 模型适配器
 *
 * 真实：当前适配器（`status.adapter`）、Key 是否存在（`status.apiKeyPresent`）。
 * 示例：运行时参数（temperature / max_steps / …）—— `status` 暂不暴露，
 * 需要 Phase 4 的 `config` RPC。
 */
export default function AdaptersScreen({ app }: { app: AppCtx }) {
  const { status, config, patchConfig, conn } = app;
  const active = status?.adapter ?? config.adapter;
  const keyPresent = status?.apiKeyPresent ?? false;

  return (
    <main className="main">
      <PageHeader
        title="模型适配器"
        sub="适配器即插件 · 切换会重建 Kernel（事件订阅由可逆副作用自动撤销重挂）"
        actions={
          <>
            <Tag mono>adapter = {active}</Tag>
          </>
        }
      />

      <Body>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* --- mock --- */}
          <Card
            hover
            style={
              active === 'mock'
                ? { borderColor: 'var(--ac-bd)', background: 'linear-gradient(160deg, rgba(109,143,255,.06), transparent 60%)' }
                : undefined
            }
          >
            <CardHead
              icon="i-plug"
              iconTone="warn"
              title="mock"
              right={
                active === 'mock' ? (
                  <Tag tone="ac">
                    <Icon name="i-check" size="s" />
                    使用中
                  </Tag>
                ) : (
                  <Btn sm tone="pri" onClick={() => patchConfig({ adapter: 'mock' })} disabled={conn !== 'ready'}>
                    切换到 mock
                  </Btn>
                )
              }
            />
            <div className="pad">
              <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.7 }}>
                离线演示剧本（查磁盘 → 试删除 → 总结）。
                <b style={{ color: 'var(--t1)' }}>用途是演示权限拦截，不是真诊断。</b>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, fontSize: 11.5 }}>
                <KV k="依赖" v="无 · 完全离线" />
                <KV k="API Key" v="不需要" />
                <KV k="函数调用" v="支持" />
                <KV k="适用场景" v="演示 / 测试 / CI" />
              </div>
            </div>
          </Card>

          {/* --- deepseek --- */}
          <Card
            hover
            style={
              active === 'deepseek'
                ? { borderColor: 'var(--ac-bd)', background: 'linear-gradient(160deg, rgba(109,143,255,.06), transparent 60%)' }
                : undefined
            }
          >
            <CardHead
              icon="i-globe"
              iconTone="info"
              title="deepseek"
              right={
                active === 'deepseek' ? (
                  <Tag tone="ac">
                    <Icon name="i-check" size="s" />
                    使用中
                  </Tag>
                ) : (
                  <Btn
                    sm
                    tone="pri"
                    disabled={!keyPresent || conn !== 'ready'}
                    title={keyPresent ? undefined : '未检测到 DEEPSEEK_API_KEY'}
                    onClick={() => patchConfig({ adapter: 'deepseek' })}
                  >
                    切换到 deepseek
                  </Btn>
                )
              }
            />
            <div className="pad">
              <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.7 }}>
                OpenAI 兼容接口的真实模型。启用前需在环境变量中提供{' '}
                <span className="mono" style={{ color: 'var(--t1)' }}>DEEPSEEK_API_KEY</span>。
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, fontSize: 11.5 }}>
                <KV k="模型" v="deepseek-chat" mono />
                <KV k="Base URL" v="api.deepseek.com" mono />
                <KV k="超时" v="60s" mono />
                <KV k="适用场景" v="真实诊断" />
              </div>
              <div style={{ marginTop: 14 }}>
                <Banner tone={keyPresent ? 'ok' : 'warn'} icon="i-key">
                  {keyPresent ? (
                    <>
                      已检测到 API Key。<b>Key 只用于判断是否存在，不会被读取或回显。</b>
                    </>
                  ) : (
                    <>
                      未检测到 API Key。Key 仅用于判断<b>是否存在</b>，不会被读取或回显。
                    </>
                  )}
                </Banner>
              </div>
            </div>
          </Card>
        </div>

        {/* --- 运行参数（示例）--- */}
        <Card>
          <CardHead
            title="运行参数"
            right={
              <>
                <Tag tone="warn">示例</Tag>
                <Label>configs/default.yaml</Label>
              </>
            }
          />
          <div className="pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <Placeholder>
              <Field label="temperature" value="0.0" mono hint="运维诊断需确定性" />
            </Placeholder>
            <Placeholder>
              <Field label="max_steps" value="8" mono hint="ReAct 最大步数" />
            </Placeholder>
            <Placeholder>
              <Field label="keep_recent" value="20" mono hint="上下文保留条数" />
            </Placeholder>
            <Placeholder>
              <Field label="max_tool_output_chars" value="4000" mono hint="单次工具输出截断" />
            </Placeholder>
          </div>
          <div style={{ padding: '0 16px 16px', fontSize: 11, color: 'var(--t4)' }}>
            参数由后端从 <span className="mono">configs/default.yaml</span> 读取；
            需要 Phase 4 的 <span className="mono">config</span> RPC 才能显示真实生效值。
          </div>
        </Card>

        {/* --- 契约（真实文档）--- */}
        <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CardHead title="适配器契约" right={<Tag tone="ac" mono>ModelAdapter</Tag>} />
          <div className="pad">
            <Code>
              async def chat(messages: list[Message], tools: list[Tool]) -&gt; Response
              {'\n'}def supports_function_calling() -&gt; bool
            </Code>
            <Banner tone="info" icon="i-box" style={{ marginTop: 14 }}>
              新增模型只需实现上面两个方法并注册为插件 —— <b>Agent 主循环一行都不用改</b>。
            </Banner>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Btn icon="i-chip" onClick={() => app.go('kernel')}>
                查看插件装配
              </Btn>
              <Btn icon="i-terminal" onClick={() => app.go('run')} disabled={conn !== 'ready'}>
                去执行诊断
              </Btn>
            </div>
          </div>
        </Card>
      </Body>
    </main>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="lbl">{k}</div>
      <div className={mono ? 'mono' : undefined} style={{ marginTop: 3 }}>
        {v}
      </div>
    </div>
  );
}

export { Dot };
