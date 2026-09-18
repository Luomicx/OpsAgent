import type { ConnectionState, BackendStatus } from "../lib/types";

interface Props {
  state: ConnectionState;
  status: BackendStatus | null;
  python: string;
  pid?: number;
}

const STATE_LABEL: Record<ConnectionState, string> = {
  connecting: "正在连接后端",
  ready: "后端就绪",
  error: "后端异常",
  stopped: "后端已停止",
};

export function TopBar({ state, status, python, pid }: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark">◆</span>
        <span>OpsAgent</span>
        <span className="sub">只读运维诊断</span>
      </div>

      <div className="topbar-spacer" />

      {status && (
        <span className="status-pill" title={`插件：${status.plugins.join(", ")}`}>
          适配器 <strong style={{ color: "var(--text)" }}>{status.adapter}</strong>
        </span>
      )}

      {status && (
        <span className="status-pill" title={`事件流：${status.sessionPath || "(内存)"}`}>
          事件 <strong style={{ color: "var(--text)" }}>{status.eventCount}</strong>
        </span>
      )}

      <span className="status-pill" title={python ? `解释器：${python}` : undefined}>
        <span className={`dot ${state}`} />
        {STATE_LABEL[state]}
        {pid ? <span style={{ color: "var(--text-faint)" }}>· {pid}</span> : null}
      </span>
    </header>
  );
}
