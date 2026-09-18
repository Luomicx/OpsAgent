import { Banner, Body, Card, CardHead } from '../layout/AppShell';
import { Btn, Empty, Placeholder } from '../ui/primitives';
import type { AppCtx } from '../../lib/appCtx';

/**
 * 12 · 空状态 / 后端断开
 *
 * 「尝试过的启动方式」目前**后端不回报**（需要 Rust 侧把
 * `SidecarManager::candidates()` 的结果通过 backend_status 暴露出来）。
 * 因此该栏标记为示例，不伪装成真实诊断结果。
 */
export default function DisconnectedScreen({ app }: { app: AppCtx }) {
  const { backendError, python, restartBackend } = app;

  return (
    <main className="main">
      <Body style={{ padding: 24, gap: 16 }}>
        <Empty
          icon="i-plug-off"
          title="Python 后端未连接"
          desc="sidecar 进程已退出，控制台无法读取内核状态。所有依赖后端的操作已自动禁用 —— 不会显示过期的缓存数据。"
          actions={
            <>
              <Btn tone="pri" icon="i-refresh" onClick={() => void restartBackend()} style={{ height: 38, padding: '0 18px' }}>
                重新启动后端
              </Btn>
              <Btn style={{ height: 38, padding: '0 18px' }}>查看启动日志</Btn>
            </>
          }
        />

        {backendError && (
          <Banner tone="bad" icon="i-alert">
            <b>最后一条错误</b> · <span className="mono selectable">{backendError}</span>
          </Banner>
        )}

        <Card style={{ marginTop: 'auto' }}>
          <CardHead title="诊断信息" right={<span className="lbl">DIAGNOSTICS</span>} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="pad" style={{ borderRight: '1px solid var(--line)' }}>
              <div className="lbl">尝试过的启动方式</div>
              <Placeholder>
                <div className="mono" style={{ fontSize: 11, lineHeight: 2, marginTop: 8, color: 'var(--t2)' }}>
                  <div>.venv/Scripts/python.exe</div>
                  <div>ops-agent-bridge (PATH)</div>
                  <div>python -m ops_agent.bridge.sidecar</div>
                </div>
              </Placeholder>
              <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 6 }}>
                后端尚未回报实际尝试列表，Phase 4 接入
              </div>
            </div>

            <div className="pad" style={{ borderRight: '1px solid var(--line)' }}>
              <div className="lbl">解释器</div>
              <div className="mono selectable" style={{ fontSize: 11, lineHeight: 1.9, marginTop: 8, color: 'var(--t2)', wordBreak: 'break-all' }}>
                {python || '（未获取到）'}
              </div>
              <div className="lbl" style={{ marginTop: 12 }}>
                最后一条错误
              </div>
              <div className="mono selectable" style={{ fontSize: 11, marginTop: 6, color: 'var(--bad)', wordBreak: 'break-all' }}>
                {backendError || '（无）'}
              </div>
            </div>

            <div className="pad">
              <div className="lbl">修复建议</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.85, marginTop: 8, color: 'var(--t2)' }}>
                在仓库根目录执行
                <br />
                <span className="mono selectable" style={{ color: 'var(--t1)' }}>
                  pip install -e &quot;.[dev]&quot;
                </span>
                <br />
                后点击「重新启动后端」。
              </div>
            </div>
          </div>
        </Card>
      </Body>
    </main>
  );
}

/** 供其他屏复用的小工具：三格诊断行 */
export function DiagGrid({ cols }: { cols: { label: string; node: React.ReactNode }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
      {cols.map((c, i) => (
        <div
          key={c.label}
          className="pad"
          style={i < cols.length - 1 ? { borderRight: '1px solid var(--line)' } : undefined}
        >
          <div className="lbl">{c.label}</div>
          <div style={{ marginTop: 8 }}>{c.node}</div>
        </div>
      ))}
    </div>
  );
}

/** 断开态的小图标按钮（备将来复用） */
export function RetryHint() {
  return (
    <Btn sm icon="i-refresh">
      重试
    </Btn>
  );
}
