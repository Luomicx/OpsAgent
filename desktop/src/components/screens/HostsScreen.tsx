import { Banner, Body, Card, CardHead, Label, PageHeader } from '../layout/AppShell';
import { Btn, Dot, Placeholder, Tag } from '../ui/primitives';
import type { AppCtx } from '../../lib/appCtx';

/**
 * 08 · 目标主机
 *
 * 现状：`status` 不包含主机清单，只有 config 里的**当前目标主机**是真实值。
 * 连接池占用、认证来源、其余主机均为示例，已显式标注。
 * 真实数据待 Phase 4 的 `hosts` RPC。
 */
export default function HostsScreen({ app }: { app: AppCtx }) {
  const { config, status } = app;
  const currentHost = config.host || '—';

  return (
    <main className="main">
      <PageHeader
        title="目标主机"
        sub="连接池按 (host, user) 复用 · 失败重试上限 3 次"
        actions={
          <>
            <Tag tone="warn">主机清单待后端上报</Tag>
          </>
        }
      />

      <Body>
        <Banner tone="warn" icon="i-alert">
          <b>当前为 dry-run 模式</b>
          ：SSH 走假连接，不会触碰真实主机。接入生产前请配置凭证（建议用环境变量，勿写明文）。
        </Banner>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {/* --- 真实：当前配置的目标主机 --- */}
          <Card hover pad style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                className="ico"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--bg-3)',
                  border: '1px solid var(--line-2)',
                  color: 'var(--t2)',
                }}
              >
                <span className="mono" style={{ fontSize: 13 }}>◎</span>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono selectable" style={{ fontSize: 13, fontWeight: 600 }}>
                  {currentHost}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--t4)' }}>
                  来自本地配置
                </div>
              </div>
              <Tag tone="ac">
                <Dot tone="ok" />
                当前目标
              </Tag>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 11.5 }}>
              <KV k="用户" v={config.user || '（默认）'} mono />
              <KV k="适配器" v={status?.adapter ?? '—'} mono />
              <KV k="认证" v="dry-run" mono />
              <KV k="连接池" v="—" mono />
            </div>
          </Card>

          {/* --- 示例：其余主机 --- */}
          <Placeholder>
            <Card hover pad style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                    10.0.1.24
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--t4)' }}>
                    生产 · web-01
                  </div>
                </div>
                <Tag tone="ok">
                  <Dot tone="ok" />
                  在线
                </Tag>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 11.5 }}>
                <KV k="用户" v="ops" mono />
                <KV k="端口" v="2222" mono />
                <KV k="延迟" v="18ms" mono />
                <KV k="池占用" v="0 / 5" mono />
              </div>
            </Card>
          </Placeholder>

          <Placeholder>
            <Card hover pad style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                    10.0.2.7
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--t4)' }}>
                    生产 · db-01
                  </div>
                </div>
                <Tag tone="bad">
                  <Dot tone="bad" />
                  连接失败
                </Tag>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 11.5 }}>
                <KV k="用户" v="ops" mono />
                <KV k="重试" v="3 / 3" mono />
                <KV k="最近错误" v="timeout" mono />
                <KV k="池占用" v="0 / 5" mono />
              </div>
            </Card>
          </Placeholder>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
          <Card style={{ display: 'flex', flexDirection: 'column' }}>
            <CardHead title="连接池参数" right={<Label>SSH CONFIG</Label>} />
            <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                <KV k="连接超时" v="10s" mono />
                <KV k="命令超时" v="15s" mono />
                <KV k="重试上限" v="3" mono />
                <KV k="池大小" v="5" mono />
              </div>
              <Banner tone="info" icon="i-clock">
                参数来自 <span className="mono">configs/default.yaml</span>
                ，运行时读取；此处为**当前生效值**，如需修改请改配置文件后重连。
              </Banner>
              <Btn
                icon="i-terminal"
                onClick={() => app.go('checker')}
                style={{ justifyContent: 'flex-start', marginTop: 'auto' }}
              >
                用校验器试一条命令（不连接主机）
              </Btn>
            </div>
          </Card>

          <Card style={{ display: 'flex', flexDirection: 'column' }}>
            <CardHead title="认证方式" right={<Tag tone="warn">待后端上报</Tag>} />
            <div style={{ overflow: 'hidden' }}>
              <table className="tbl tc">
                <thead>
                  <tr>
                    <th>主机</th>
                    <th>方式</th>
                    <th>凭证来源</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">{currentHost}</td>
                    <td>无</td>
                    <td className="mono" style={{ color: 'var(--t4)' }}>
                      —
                    </td>
                    <td>
                      <Tag tone="info">dry-run</Tag>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ padding: '0 16px 16px', marginTop: 'auto' }}>
              <Banner tone="warn" icon="i-key">
                凭证仅从环境变量展开，<b>不落盘、不写入事件流</b>。
              </Banner>
            </div>
          </Card>
        </div>
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
