import { Banner, Body, Card, CardHead, Label, PageHeader } from '../layout/AppShell';
import { Btn, Dot, Tag } from '../ui/primitives';
import Icon from '../ui/Icon';
import type { AppCtx } from '../../lib/appCtx';

/**
 * 设置
 *
 * ⚠️ 设计稿的 12 个画板里**没有**这一屏（侧栏有「设置」入口但无对应画板）。
 * 本屏按同一设计语言补齐，内容**全部来自真实后端状态**，不新增视觉范式。
 */
export default function SettingsScreen({ app }: { app: AppCtx }) {
  const { status, conn, python, pid, config, patchConfig, restartBackend } = app;

  return (
    <main className="main">
      <PageHeader
        title="设置"
        sub="运行参数与后端信息"
        actions={
          <>
            <Tag tone={conn === 'ready' ? 'ok' : 'bad'}>
              <Dot tone={conn === 'ready' ? 'ok' : 'bad'} breathe={conn === 'ready'} />
              {conn === 'ready' ? '后端就绪' : '后端未连接'}
            </Tag>
            <Btn icon="i-refresh" onClick={() => void restartBackend()}>
              重启后端
            </Btn>
          </>
        }
      />

      <Body>
        {/* ---------------- 后端进程 ---------------- */}
        <Card>
          <CardHead icon="i-terminal" iconTone="ac" title="后端进程" right={<Label>PYTHON SIDECAR</Label>} />
          <div className="pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <KV k="解释器" v={python || '（未获取）'} mono wrap />
            <KV k="PID" v={pid ? String(pid) : '—'} mono />
            <KV k="适配器" v={status?.adapter ?? '—'} mono />
            <KV k="配置文件" v={status?.configPath ?? '—'} mono wrap />
            <KV k="事件流" v={status?.sessionPath ?? '—'} mono wrap />
            <KV k="已落盘事件" v={status ? String(status.eventCount) : '—'} mono />
          </div>
        </Card>

        {/* ---------------- 目标主机 ---------------- */}
        <Card>
          <CardHead icon="i-server" iconTone="info" title="默认目标主机" right={<Label>LOCAL CONFIG</Label>} />
          <div className="pad" style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="fld" style={{ minWidth: 220 }}>
              <label>主机</label>
              <div className="inp">
                <input
                  value={config.host}
                  placeholder="demo-host"
                  onChange={(e) => patchConfig({ host: e.target.value })}
                />
              </div>
            </div>
            <div className="fld" style={{ minWidth: 180 }}>
              <label>SSH 用户</label>
              <div className="inp">
                <input
                  value={config.user}
                  placeholder="（使用默认）"
                  onChange={(e) => patchConfig({ user: e.target.value })}
                />
              </div>
            </div>
            <div className="fld" style={{ minWidth: 180 }}>
              <label>适配器</label>
              <div className="inp" style={{ justifyContent: 'space-between' }}>
                {config.adapter}
                <Icon name="i-chev-d" size="s" />
              </div>
            </div>
            <Btn tone="gh" icon="i-server" onClick={() => app.go('hosts')}>
              主机管理
            </Btn>
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            <Banner tone="info" icon="i-info">
              这些值保存在浏览器本地存储，<b>不包含任何凭据</b>；凭据只从环境变量读取。
            </Banner>
          </div>
        </Card>

        {/* ---------------- 能力开关（只读） ---------------- */}
        <Card>
          <CardHead icon="i-sliders" title="安全策略" right={<Tag tone="mut">只读</Tag>} />
          <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0 }}>
            <Row
              icon="i-shield"
              tone="bad"
              title="默认只读模式"
              desc="默认拒绝一切写操作；写操作需显式开启"
              value="已启用"
            />
            <Row
              icon="i-zap"
              tone="warn"
              title="重试上限"
              desc="连接失败不重试超过 3 次，避免暴力尝试"
              value="3 次"
            />
            <Row
              icon="i-key"
              tone="info"
              title="凭据来源"
              desc="仅从环境变量展开，不落盘、不写入事件流"
              value={status?.apiKeyPresent ? '已配置' : '未配置'}
            />
            <Row
              icon="i-list"
              tone="pur"
              title="事件流脱敏"
              desc="出站统一递归抹掉疑似凭据字段"
              value="已启用"
              last
            />
          </div>
        </Card>

        {/* ---------------- 已知边界 ---------------- */}
        <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CardHead
            icon="i-alert"
            iconTone="warn"
            title="已知安全边界"
            right={
              <Btn sm tone="gh" icon="i-shield" onClick={() => app.go('permissions')}>
                查看权限分层
              </Btn>
            }
          />
          <div className="pad">
            <Banner tone="warn" icon="i-alert">
              <b>L1–L3 检查的是「命令」，没有任何一层检查「路径」。</b>
              实测 <span className="mono">cat /etc/shadow</span>、
              <span className="mono">cat ~/.ssh/id_rsa</span> 可通过全部三层校验。
              这是架构层面的空白（L5 待实现），补上之前<b>不要把本项目指向含敏感数据的主机</b>。
            </Banner>
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <Btn icon="i-file" onClick={() => app.go('audit')}>
                查看事件审计
              </Btn>
              <Btn icon="i-terminal-2" onClick={() => app.go('checker')}>
                自己验一下
              </Btn>
            </div>
          </div>
        </Card>
      </Body>
    </main>
  );
}

function KV({ k, v, mono, wrap }: { k: string; v: string; mono?: boolean; wrap?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="lbl">{k}</div>
      <div
        className={mono ? 'mono selectable' : undefined}
        style={{ marginTop: 4, fontSize: 12.5, wordBreak: wrap ? 'break-all' : undefined }}
      >
        {v}
      </div>
    </div>
  );
}

function Row({
  icon,
  tone,
  title,
  desc,
  value,
  last,
}: {
  icon: 'i-shield' | 'i-zap' | 'i-key' | 'i-list';
  tone: 'ok' | 'bad' | 'warn' | 'info' | 'pur';
  title: string;
  desc: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 15px',
        borderBottom: last ? 'none' : '1px solid var(--line)',
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          display: 'grid',
          placeItems: 'center',
          flex: '0 0 34px',
          color: `var(--${tone})`,
          background: `var(--${tone}-bg)`,
        }}
      >
        <Icon name={icon} size="s" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{desc}</div>
      </div>
      <Tag tone={tone}>{value}</Tag>
    </div>
  );
}
