/**
 * 业务 API —— 把 RPC 方法名收敛到一处，并给每个方法正确的类型。
 *
 * 这一层是「前端的 domain service」：组件只调这里的函数，
 * 不需要知道 RPC 方法叫什么、参数是什么形状。
 */

import { invoke } from "@tauri-apps/api/core";
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
};

export type Api = typeof api;
