import { Banner, Body, Card, CardHead, Label, PageHeader } from '../layout/AppShell';
import { Btn, Placeholder, Tag } from '../ui/primitives';
import Icon from '../ui/Icon';
import type { IconId } from '../ui/IconSprite';
import type { AppCtx } from '../../lib/appCtx';

/**
 * 拓扑节点：[left, top, width, 节点名, 图标, 图标色]
 * 坐标与设计稿 09 屏逐值一致。
 */
const NODES: [number, number, number, string, IconId, string][] = [
  [16, 12, 168, 'session_store', 'i-database', 'var(--pur)'],
  [16, 68, 168, 'tool_registry', 'i-list', 'var(--t3)'],
  [16, 124, 168, 'permission_pipeline', 'i-shield', 'var(--t3)'],
  [16, 180, 168, 'ssh_pool', 'i-globe', 'var(--t3)'],
  [250, 40, 164, 'ssh_execute', 'i-terminal', 'var(--t3)'],
  [250, 88, 164, 'ssh_read_file', 'i-file', 'var(--t3)'],
  [250, 136, 164, 'ssh_list_dir', 'i-grid', 'var(--t3)'],
  [250, 192, 164, 'model_adapter', 'i-plug', 'var(--warn)'],
  [476, 112, 164, 'agent_loop', 'i-zap', 'var(--ac)'],
];

/**
 * 09 · 内核 · 插件与能力
 *
 * - 插件清单与能力注册表：**真实**（来自 `status`）
 * - 依赖拓扑图：标注为「架构示意」—— 节点名取自真实插件集，
 *   但**依赖边**需要 Phase 4 的 `kernelTopology` RPC 才能反映运行时真实连边
 */
export default function KernelScreen({ app }: { app: AppCtx }) {
  const { status, conn } = app;
  const plugins = status?.plugins ?? [];
  const caps = status?.capabilities ?? {};
  const tools = status?.tools ?? [];

  return (
    <main className="main">
      <PageHeader
        title="内核 · 插件与能力"
        sub="Kernel 只负责加载 / 卸载 / 依赖拓扑 —— 不含任何业务逻辑"
        actions={
          <>
            <Tag tone={conn === 'ready' ? 'ok' : 'mut'}>
              {conn === 'ready' ? `${plugins.length} 个插件已加载` : '等待后端'}
            </Tag>
          </>
        }
      />

      <Body>
        <Banner tone="info" icon="i-box">
          新增能力 = 新增插件。模型适配器、工具、权限层全部可热插拔，
          <b>内核里没有任何业务分支</b>。
        </Banner>

        <div style={{ display: 'grid', gridTemplateColumns: '376px 1fr', gap: 14 }}>
          {/* ---- 真实：已加载插件 ---- */}
          <Card>
            <CardHead title="已加载插件" right={<Label>{plugins.length} 个</Label>} />
            <div style={{ overflow: 'auto' }}>
              <table className="tbl tc">
                <thead>
                  <tr>
                    <th>插件</th>
                    <th style={{ width: 90 }}>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {plugins.length === 0 && (
                    <tr>
                      <td colSpan={2} style={{ color: 'var(--t4)' }}>
                        后端尚未上报插件清单。
                      </td>
                    </tr>
                  )}
                  {plugins.map((p) => (
                    <tr key={p}>
                      <td className="mono" style={{ color: 'var(--t1)' }}>
                        {p}
                      </td>
                      <td>
                        <Tag tone="ok">已加载</Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ margin: '14px 16px 16px' }}>
              <Banner tone="ok" icon="i-check">
                所有插件都应登记了 <span className="mono">on_unload</span> 撤销动作，卸载时可完全回滚。
              </Banner>
            </div>
          </Card>

          {/* ---- 示意：依赖拓扑 ---- */}
          <Card style={{ display: 'flex', flexDirection: 'column' }}>
            <CardHead
              title="能力依赖拓扑"
              right={
                <>
                  <Tag tone="warn">架构示意</Tag>
                  <Tag tone="pur" mono>
                    ✻ 通配订阅
                  </Tag>
                </>
              }
            />
            <div className="pad" style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              <Placeholder>
                <div className="topo" style={{ width: 660, height: 240 }}>
                  <svg width="660" height="240" viewBox="0 0 660 240" style={{ position: 'absolute', left: 0, top: 0 }}>
                    <path d="M184,85 C216,85 216,57 250,57" />
                    <path d="M184,85 C216,85 216,105 250,105" />
                    <path d="M184,85 C220,85 214,153 250,153" />
                    <path d="M184,197 C226,197 214,57 250,57" />
                    <path d="M184,197 C226,197 224,105 250,105" />
                    <path d="M184,197 C224,197 224,153 250,153" />
                    <path className="hi" d="M184,141 C300,141 330,129 476,129" />
                    <path d="M414,57 C446,57 446,129 476,129" />
                    <path d="M414,105 C446,105 446,129 476,129" />
                    <path d="M414,153 C446,153 446,129 476,129" />
                    <path d="M414,209 C446,209 446,146 476,146" />
                    <path
                      d="M100,46 C100,64 100,68 100,68"
                      style={{ stroke: 'rgba(155,126,217,.5)', strokeDasharray: '3 3' }}
                    />
                  </svg>
                  {NODES.map(([left, top, width, name, icon, color]) => {
                    const loaded = plugins.some((p) => p.includes(name.split('_')[0]));
                    return (
                      <span
                        key={name}
                        className={`nd ${name === 'agent_loop' ? 'hi' : ''}`}
                        style={{ left, top, width, opacity: loaded ? 1 : 0.55 }}
                        title={loaded ? '已加载' : '当前内核未加载该插件'}
                      >
                        <span style={{ color, display: 'flex' }}>
                          <Icon name={icon} size="s" />
                        </span>
                        {name}
                      </span>
                    );
                  })}
                </div>
              </Placeholder>
            </div>
            <div style={{ padding: '0 16px 16px', fontSize: 11, color: 'var(--t4)' }}>
              依赖边需 Phase 4 的 <span className="mono">kernelTopology</span> RPC 才能反映运行时真实连边；
              节点名取自真实插件集，未加载的插件以 55% 不透明度表示。
            </div>
          </Card>
        </div>

        {/* ---- 真实：能力注册表 + 工具 ---- */}
        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <CardHead title="能力注册表" right={<Label>CAPABILITY ← PROVIDER</Label>} />
          <div className="pad" style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            {Object.entries(caps).map(([cap, provider]) => (
              <Tag key={cap} mono>
                {cap} ← {provider}
              </Tag>
            ))}
            {Object.keys(caps).length === 0 && (
              <span style={{ fontSize: 11.5, color: 'var(--t4)' }}>后端尚未上报能力注册表。</span>
            )}
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            <Banner tone="info" icon="i-branch">
              能力被重复提供时内核会告警 —— 插件声明提供但未注册也会被检出，尽早暴露装配错误。
            </Banner>
          </div>
        </Card>

        <Card>
          <CardHead title="已注册工具" right={<Label>{tools.length} 个</Label>} />
          <div className="pad" style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            {tools.map((t) => (
              <Tag key={t} tone="ac" mono>
                {t}
              </Tag>
            ))}
            {tools.length === 0 && (
              <span style={{ fontSize: 11.5, color: 'var(--t4)' }}>后端尚未上报工具清单。</span>
            )}
            <Btn sm tone="gh" icon="i-terminal" onClick={() => app.go('checker')} style={{ marginLeft: 'auto' }}>
              去校验命令
            </Btn>
          </div>
        </Card>
      </Body>
    </main>
  );
}
