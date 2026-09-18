import type { TimelineEntry, TimelineKind } from "../lib/types";

/** 每种语义的图标与配色 —— 视觉上区分「放行」与「拦截」是界面的核心价值。 */
const STYLE: Record<TimelineKind, { icon: string; color: string; bg: string }> = {
  input: { icon: "▸", color: "var(--accent)", bg: "rgba(74,158,255,0.14)" },
  think: { icon: "◌", color: "var(--text-dim)", bg: "rgba(154,167,182,0.12)" },
  tool: { icon: "⌘", color: "var(--text-dim)", bg: "rgba(154,167,182,0.12)" },
  allowed: { icon: "✓", color: "var(--ok)", bg: "rgba(47,191,143,0.14)" },
  denied: { icon: "⊘", color: "var(--danger)", bg: "rgba(240,96,63,0.16)" },
  error: { icon: "!", color: "var(--danger)", bg: "rgba(240,96,63,0.16)" },
  final: { icon: "★", color: "var(--accent)", bg: "rgba(74,158,255,0.14)" },
  system: { icon: "·", color: "var(--text-faint)", bg: "rgba(107,120,135,0.12)" },
};

const timeOf = (ts: number): string => {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

interface Props {
  entries: TimelineEntry[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
}

export function Timeline({ entries, expanded, onToggle }: Props) {
  if (entries.length === 0) {
    return (
      <div className="timeline-wrap">
        <div className="empty">
          <div className="big">⬚</div>
          <div>还没有事件</div>
          <div className="hint">
            在左侧填好主机、下达一条只读诊断指令，这里会实时显示 Agent 的每一步：
            推理 → 工具调用 → 权限校验 → 结论。
            <br />
            用 <code>mock</code> 适配器可以零配置跑通整条链路。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-wrap">
      <div className="timeline">
        {entries.map((entry, index) => {
          const style = STYLE[entry.kind];
          const hasBody = Boolean(entry.body);
          const open = expanded.has(entry.id);
          const isLast = index === entries.length - 1;

          return (
            <div
              key={entry.id}
              className={[
                "entry",
                entry.kind === "denied" ? "denied" : "",
                entry.kind === "final" ? "final" : "",
                hasBody ? "clickable" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => hasBody && onToggle(entry.id)}
              title={hasBody ? (open ? "点击收起" : "点击展开") : undefined}
            >
              <div className="entry-rail">
                <span
                  className="entry-icon"
                  style={{ color: style.color, background: style.bg }}
                >
                  {style.icon}
                </span>
                {!isLast && <span className="entry-line" />}
              </div>

              <div className="entry-body">
                <div className="entry-head">
                  <span className="entry-title">{entry.title}</span>
                  {entry.seq != null && (
                    <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                      #{entry.seq}
                    </span>
                  )}
                  <span className="entry-time">{timeOf(entry.ts)}</span>
                </div>

                {entry.detail && <div className="entry-detail">{entry.detail}</div>}

                {hasBody && open && <div className="entry-code">{entry.body}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
