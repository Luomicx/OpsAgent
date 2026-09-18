/**
 * 事件 → 时间线的归约逻辑。
 *
 * 事件流是 Agent 的「公开账本」：`agent.input` / `agent.think` / `tool.before` /
 * `permission.denied` / `tool.after` / `agent.final` 这些事件按序到达，
 * GUI 的任务就是把它们翻译成人类可读的时间线。
 *
 * 之所以把这段逻辑抽成**纯函数**：
 *
 * 1. 可以脱离 DOM 单测（见 `desktop/src/lib/timeline.test.ts`）
 * 2. 同一套归约既能处理实时事件，也能处理回放（回放事件只多一个 seq）
 * 3. 组件保持无逻辑，只负责画
 */

import type { TimelineEntry, TimelineKind } from "./types";

/** 事件类型 → 语义分类。未登记的类型统一归为 system。 */
const KIND_BY_EVENT: Record<string, TimelineKind> = {
  "agent.input": "input",
  "agent.think": "think",
  "tool.before": "tool",
  "permission.allowed": "allowed",
  "permission.denied": "denied",
  "tool.after": "tool",
  "tool.error": "error",
  "agent.error": "error",
  "agent.final": "final",
  "session.start": "system",
  "session.end": "system",
  "ssh.connect": "system",
  "ssh.command": "system",
  "context.compact": "system",
};

export const kindOf = (eventType: string): TimelineKind =>
  KIND_BY_EVENT[eventType] ?? "system";

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : value == null ? fallback : String(value);

const num = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

/**
 * 把一条事件转成时间线条目；返回 null 表示这条事件不需要上时间线。
 *
 * 被过滤掉的是**冗余事件**：例如 `tool.after` 成功时的信息已经包含在
 * `tool.before` 的目标里，只有失败/被拒时才值得单独成条。
 */
export function toTimelineEntry(
  eventType: string,
  data: Record<string, unknown>,
  ts: number,
  seq?: number,
): TimelineEntry | null {
  const kind = kindOf(eventType);
  const base = { ts, eventType, seq };

  switch (eventType) {
    case "agent.input":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: "指令",
        detail: str(data.input),
      };

    case "agent.think":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: `推理 · 第 ${num(data.step) ?? "?"} 步`,
        detail: `${num(data.messages) ?? 0} 条上下文`,
      };

    case "tool.before":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: str(data.tool, "工具调用"),
        detail: str(data.command),
      };

    case "permission.allowed":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: "权限通过",
        detail: str(data.command),
      };

    case "permission.denied":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: `拦截 · ${str(data.layer, "?")}`,
        detail: str(data.reason),
        // 被拒的命令与命中规则值得留档，方便复盘绕过尝试
        body: [str(data.command) && `命令：${str(data.command)}`, str(data.rule) && `命中规则：${str(data.rule)}`]
          .filter(Boolean)
          .join("\n"),
      };

    case "tool.after": {
      const ok = data.ok === true;
      // 成功的工具调用在 tool.before 已经上过时间线，这里只在异常时提示
      if (ok) return null;
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind: "denied",
        title: `未执行 · ${str(data.tool, "工具")}`,
        detail: str(data.reason, "被安全策略拒绝"),
        body: str(data.denied_by) ? `拒绝层：${str(data.denied_by)}` : undefined,
      };
    }

    case "tool.error":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: `工具异常 · ${str(data.tool, "")}`,
        detail: str(data.error),
      };

    case "agent.final":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: "得出结论",
        detail: `${num(data.length) ?? 0} 字 · 第 ${num(data.step) ?? "?"} 步`,
      };

    case "agent.error":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: "循环中止",
        detail: str(data.reason),
      };

    case "session.start":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: "会话开始",
        detail: str(data.host) ? `主机 ${str(data.host)}` : "已建立事件流",
      };

    case "ssh.connect":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: "SSH 连接",
        detail: `${str(data.host)}${str(data.user) ? ` @${str(data.user)}` : ""}`,
      };

    case "ssh.command":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: "远程执行",
        detail: str(data.command),
      };

    case "context.compact":
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind,
        title: "上下文压缩",
        detail: `保留 ${num(data.keep) ?? "?"} 条`,
      };

    default:
      // 未登记的类型：仍然展示，但不假装理解它
      return {
        ...base,
        id: idOf(eventType, seq, ts),
        kind: "system",
        title: eventType,
        detail: "",
      };
  }
}

let counter = 0;
const idOf = (eventType: string, seq: number | undefined, ts: number): string =>
  seq != null ? `seq-${seq}` : `${eventType}-${ts}-${counter++}`;

/** 批量归约（回放场景），过滤掉不上时间线的事件。 */
export function reduceEvents(
  events: { type: string; data: Record<string, unknown>; ts: number; seq?: number }[],
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const event of events) {
    const entry = toTimelineEntry(event.type, event.data, event.ts, event.seq);
    if (entry) out.push(entry);
  }
  return out;
}
