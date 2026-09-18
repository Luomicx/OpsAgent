/**
 * 协议类型定义 —— 与 Python 侧 `bridge/serialize.py` 一一对应。
 *
 * 改动这里时必须同步改 `src/ops_agent/bridge/serialize.py`，
 * 两侧靠字段名约定耦合（后端出 JSON 用 camelCase，便于前端直接消费）。
 */

// ------------------------------------------------------------------ RPC
export interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcError {
  code: number;
  message: string;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: RpcError;
}

/** 服务端主动推送（没有 id）。 */
export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

export type InboundMessage = RpcResponse | RpcNotification;

/**
 * 推送与响应的判别依据：**有没有 id**。
 *
 * 用 `in` 而不是读 `.method` —— 直接访问会让 TS 在联合类型上报错
 * （`RpcResponse` 没有 method），而 `in` 能正确窄化。
 */
export const isNotification = (msg: InboundMessage): msg is RpcNotification =>
  "method" in msg && !("id" in msg);

// ------------------------------------------------------------------ 领域对象
export interface StepRecord {
  tool: string;
  command: string;
  args: Record<string, unknown>;
  allowed: boolean;
  denied: boolean;
  layer: string;
  reason: string;
  output: string;
  outputLength: number;
}

export interface AgentResult {
  text: string;
  finished: boolean;
  stepsUsed: number;
  steps: StepRecord[];
  deniedCount: number;
  status?: BackendStatus;
}

export interface PermissionDecision {
  allowed: boolean;
  layer: string;
  reason: string;
  rule: string;
}

export interface PermissionRule {
  pattern: string;
  kind: string;
  description: string;
}

export interface PermissionLayer {
  layer: string;
  name: string;
  description: string;
  ruleCount: number;
  rules: PermissionRule[];
}

export interface PermissionReport {
  layers: PermissionLayer[];
  totalRules: number;
}

export interface SessionEvent {
  seq: number;
  type: string;
  ts: number;
  data: Record<string, unknown>;
}

export interface BackendStatus {
  ready: boolean;
  adapter: string;
  configPath: string;
  sessionPath: string;
  eventCount: number;
  tools: string[];
  plugins: string[];
  capabilities: Record<string, string>;
  apiKeyPresent: boolean;
}

// ------------------------------------------------------------------ 时间线
/** 时间线单元的语义分类 —— 决定图标与配色。 */
export type TimelineKind =
  | "input"
  | "think"
  | "tool"
  | "allowed"
  | "denied"
  | "error"
  | "final"
  | "system";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  /** 主标题（如工具名、事件摘要） */
  title: string;
  /** 次要说明（如命令、拒绝原因） */
  detail: string;
  /** 展开后的完整内容（如工具输出） */
  body?: string;
  ts: number;
  /** 事件的原始类型，便于调试 */
  eventType: string;
  seq?: number;
}

// ------------------------------------------------------------------ 配置
export interface RunOptions {
  host: string;
  user: string;
  prompt: string;
  adapter: "mock" | "deepseek";
}

export type ConnectionState = "connecting" | "ready" | "error" | "stopped";

/** Rust 侧 `backend_status` 命令的返回（进程级信息，与 Kernel 状态不同）。 */
export interface BackendProcessStatus {
  running: boolean;
  pid?: number;
  python: string;
}
