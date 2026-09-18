/**
 * 业务 API —— 把 RPC 方法名收敛到一处，并给每个方法正确的类型。
 *
 * 这一层是「前端的 domain service」：组件只调这里的函数，
 * 不需要知道 RPC 方法叫什么、参数是什么形状。
 */

import { invoke } from "./bridge";
import { rpc } from "./rpc";
import type {
  AgentResult,
  BackendProcessStatus,
  BackendStatus,
  PermissionDecision,
  PermissionReport,
  SessionEvent,
} from "./types";

export const api = {
  /** 探活。 */
  ping: () => rpc.call<{ pong: boolean; ready: boolean; adapter: string }>("ping"),

  /** 读取后端状态快照（Kernel 层：插件、工具、事件数）。 */
  status: () => rpc.call<BackendStatus>("status"),

  /** 读取后端**进程**状态（pid、解释器路径）—— 直接问 Rust 层。 */
  process: () => invoke<BackendProcessStatus>("backend_status"),

  /** 切换适配器 / 事件流路径（会重建 Kernel）。 */
  configure: (options: { adapter?: string; sessionPath?: string }) =>
    rpc.call<BackendStatus>("configure", options),

  /** 执行一次诊断 —— 这是主流程。 */
  run: (options: { host: string; user?: string; prompt: string }) =>
    rpc.call<AgentResult>("run", {
      host: options.host,
      user: options.user || null,
      prompt: options.prompt,
    }),

  /** 只做权限校验，不连主机。 */
  checkCommand: (command: string, host = "") =>
    rpc.call<{ command: string; decision: PermissionDecision }>("checkCommand", {
      command,
      host,
    }),

  /** 拉取三层权限规则。 */
  permission: () => rpc.call<PermissionReport>("permission"),

  /** 回放已落盘的事件流。 */
  replay: (path?: string) =>
    rpc.call<{ path: string; events: SessionEvent[]; integrity: boolean }>("replay", {
      path: path ?? null,
    }),

  /**
   * 取消当前在途的诊断。
   *
   * 刻意不传 targetId —— GUI 只需要「停下正在跑的那个」，
   * 不该去关心协议层的请求 id。
   */
  cancel: (reason = "用户取消") =>
    rpc.call<{ cancelled: boolean; count: number }>("cancel", { reason }),

  /* ------------------------------------------------------------------
     规则写入（决策 1B —— 可写）
     安全约束（见 docs/UI-REFACTOR-PLAN.md §7.4）：
       1. 只写 configs/permission_rules.local.yaml，永不触碰默认规则文件
       2. 调用前必须由 UI 做二次确认，并展示具体 diff
       3. 后端写入时必须落审计事件
       4. 保存后必须重载流水线并回报结果

     ⚠️ 后端（Phase 4）尚未实现 rulesSave / rulesDiff。
     当前调用会返回 -32601（METHOD_NOT_FOUND），UI 会**原样呈现该错误**，
     不会静默假装保存成功。
     ------------------------------------------------------------------ */

  /** 变更预览：新增 / 修改 / 删除 + 校验结果 */
  rulesDiff: (rules: RulesPayload) => rpc.call<RulesDiff>("rulesDiff", { rules }),

  /** 确认写入 + 重载流水线 */
  rulesSave: (rules: RulesPayload) => rpc.call<RulesSaveResult>("rulesSave", { rules }),
};

/** 提交给后端的规则形态（按层分组，只含可编辑字段） */
export interface RulesPayload {
  layers: {
    layer: string;
    rules: { pattern: string; kind: string; description: string }[];
  }[];
}

export interface RulesDiff {
  added: string[];
  removed: string[];
  changed: { pattern: string; before: string; after: string }[];
  /** 后端对拟写入规则的静态校验结果 */
  invalid: { pattern: string; reason: string }[];
  targetFile: string;
}

export interface RulesSaveResult {
  ok: boolean;
  /** 生效的规则总数（重载后） */
  totalRules: number;
  /** 本次写入产生的审计事件 seq */
  auditSeq?: number;
  targetFile: string;
}

export type Api = typeof api;
