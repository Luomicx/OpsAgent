import type { BackendStatus, ConnectionState, RunOptions } from "../lib/types";

interface Props {
  options: RunOptions;
  onChange: (next: Partial<RunOptions>) => void;
  status: BackendStatus | null;
  state: ConnectionState;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
  onRestart: () => void;
}

export function Sidebar({
  options,
  onChange,
  status,
  state,
  busy,
  onRun,
  onCancel,
  onRestart,
}: Props) {
  const needsKey = options.adapter === "deepseek" && status?.apiKeyPresent === false;
  const canRun = state === "ready" && !busy;

  return (
    <aside className="sidebar">
      <div className="section">
        <div className="section-title">目标主机</div>

        <div className="field">
          <label htmlFor="host">主机</label>
          <input
            id="host"
            value={options.host}
            placeholder="192.168.1.10 或 demo-host"
            onChange={(e) => onChange({ host: e.target.value })}
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="user">SSH 用户（可选）</label>
          <input
            id="user"
            value={options.user}
            placeholder="留空则用配置默认值"
            onChange={(e) => onChange({ user: e.target.value })}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="section">
        <div className="section-title">模型适配器</div>
        <select
          value={options.adapter}
          onChange={(e) => onChange({ adapter: e.target.value as RunOptions["adapter"] })}
        >
          <option value="mock">mock · 离线演示剧本</option>
          <option value="deepseek">deepseek · 真实模型</option>
        </select>

        <div style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
          {options.adapter === "mock" ? (
            <>
              走固定演示剧本（查磁盘 → 试删除 → 总结）。
              <strong style={{ color: "var(--text-dim)" }}> 用途是演示权限拦截，不是真诊断。</strong>
            </>
          ) : needsKey ? (
            <span style={{ color: "var(--warn)" }}>
              未检测到 <code>DEEPSEEK_API_KEY</code>，请先在环境变量中设置。
            </span>
          ) : (
            "使用真实模型做诊断，SSH 仍走假连接（不连真实主机）。"
          )}
        </div>
      </div>

      <div className="section">
        <div className="section-title">运行</div>
        <button className="btn primary" disabled={!canRun} onClick={onRun}>
          {busy ? (
            <>
              <span className="spinner" />
              诊断中…
            </>
          ) : (
            "开始诊断"
          )}
        </button>
        {busy && (
          <button className="btn danger" onClick={onCancel}>
            取消
          </button>
        )}
        {state !== "ready" && (
          <button className="btn ghost sm" onClick={onRestart}>
            重启后端
          </button>
        )}
      </div>

      {status && (
        <div className="section">
          <div className="section-title">已加载插件 · {status.plugins.length}</div>
          <div className="chip-list">
            {status.plugins.map((name) => (
              <span key={name} className="chip">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {status && (
        <div className="section">
          <div className="section-title">可用工具 · {status.tools.length}</div>
          <div className="chip-list">
            {status.tools.map((name) => (
              <span key={name} className="chip">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
