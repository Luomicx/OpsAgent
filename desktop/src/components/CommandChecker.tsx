import { useState } from "react";
import type { PermissionDecision } from "../lib/types";

/** 预置样本 —— 覆盖「放行」与 L1/L2/L3 三层各自的拦截。 */
const PRESETS: { label: string; command: string; note: string }[] = [
  { label: "df -h", command: "df -h", note: "只读查询，应放行" },
  { label: "free -m", command: "free -m", note: "只读查询，应放行" },
  { label: "rm -rf /", command: "rm -rf /", note: "L1 硬黑名单" },
  { label: "top", command: "top", note: "L2 缺 -b 会阻塞会话" },
  { label: "df -h; ls", command: "df -h; ls", note: "L3 分号串联" },
  { label: "ls $(whoami)", command: "ls $(whoami)", note: "L3 命令替换" },
  { label: "cat /etc/passwd > /tmp/x", command: "cat /etc/passwd > /tmp/x", note: "L3 重定向写入" },
];

interface Props {
  result: { command: string; decision: PermissionDecision } | null;
  busy: boolean;
  error: string;
  onCheck: (command: string) => void;
  onClear: () => void;
}

export function CommandChecker({ result, busy, error, onCheck, onClear }: Props) {
  const [command, setCommand] = useState("");

  const submit = () => {
    const trimmed = command.trim();
    if (trimmed) onCheck(trimmed);
  };

  return (
    <div className="panel-scroll">
      <div className="checker">
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.7 }}>
          不连接任何主机，直接把一条命令喂给三层权限流水线，查看它会被放行还是拦截。
          <strong style={{ color: "var(--text)" }}> 这是理解权限引擎最快的方式。</strong>
        </div>

        <div className="checker-input">
          <input
            value={command}
            placeholder="输入要检查的命令，例如：rm -rf /"
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setCommand("");
                onClear();
              }
            }}
            spellCheck={false}
          />
          <button className="btn primary" disabled={busy || !command.trim()} onClick={submit}>
            {busy ? <span className="spinner" /> : "校验"}
          </button>
          {result && (
            <button className="btn ghost" onClick={onClear}>
              清空
            </button>
          )}
        </div>

        <div className="presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.command}
              className="preset"
              title={preset.note}
              onClick={() => {
                setCommand(preset.command);
                onCheck(preset.command);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="verdict-card deny">
            <div className="verdict-card-title">校验失败</div>
            <div style={{ fontSize: 12.5 }}>{error}</div>
          </div>
        )}

        {result && (
          <div className={`verdict-card ${result.decision.allowed ? "allow" : "deny"}`}>
            <div className="verdict-card-title">
              <span>{result.decision.allowed ? "✓" : "⊘"}</span>
              {result.decision.allowed ? "放行" : "拒绝"}
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: "var(--text-faint)",
                  fontFamily: "var(--mono)",
                }}
              >
                [{result.decision.layer}]
              </span>
            </div>

            <dl className="kv">
              <dt>命令</dt>
              <dd>{result.command}</dd>
              <dt>判定</dt>
              <dd>{result.decision.reason}</dd>
              {result.decision.rule && (
                <>
                  <dt>命中规则</dt>
                  <dd>{result.decision.rule}</dd>
                </>
              )}
            </dl>
          </div>
        )}

        <div style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.8 }}>
          <strong style={{ color: "var(--text-dim)" }}>三层顺序：</strong>
          L1 全局黑名单（正则 + 字面量，抗变形写法）→ L2 命令白名单（逐段拆分，禁提权 / 禁危险参数）
          → L3 Shell 注入检测（命令替换、重定向、引号闭合）。任一层拒绝即短路返回，
          不再往下走。
        </div>
      </div>
    </div>
  );
}
