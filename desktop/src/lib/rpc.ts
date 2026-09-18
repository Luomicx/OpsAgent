/**
 * 与 Python sidecar 通信的 RPC 客户端。
 *
 * 职责边界很清晰：
 *
 * - **请求/响应对配**：每个请求发出去时带自增 id，收到带同 id 的响应就 resolve
 * - **事件分流**：没有 id 的消息是推送，广播给所有订阅者
 * - **超时兜底**：请求长期无响应时 reject，避免 UI 永久转圈
 *
 * 它不知道任何业务语义（不认识 "run" 或 "permission"），
 * 上层 `api.ts` 才是业务封装。这样换协议只改这一层。
 */

// Tauri IPC 经由 bridge 间接调用，使浏览器预览可挂接替身实现
import { invoke, listen, type UnlistenFn } from "./bridge";
import type { InboundMessage, RpcNotification, RpcRequest, RpcResponse } from "./types";
import { isNotification } from "./types";

type NotificationHandler = (notification: RpcNotification) => void;
type StatusHandler = (payload: unknown) => void;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

/** 默认超时：run 可能跑很久，所以给得比较宽松，由取消机制来兜底。 */
const DEFAULT_TIMEOUT_MS = 180_000;

export class RpcClient {
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private notificationHandlers = new Set<NotificationHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private unlisten: UnlistenFn[] = [];
  private booted = false;

  /** 挂载 Tauri 事件监听 —— 必须在发第一个请求前调用一次。 */
  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;

    this.unlisten.push(
      await listen<string>("rpc://message", (event) => {
        this.handleLine(event.payload);
      }),
    );

    this.unlisten.push(
      await listen<unknown>("backend://status", (event) => {
        this.emitStatus({ kind: "ready", payload: event.payload });
      }),
    );

    this.unlisten.push(
      await listen<unknown>("backend://error", (event) => {
        this.emitStatus({ kind: "error", payload: event.payload });
      }),
    );

    this.unlisten.push(
      await listen<unknown>("backend://exit", (event) => {
        this.emitStatus({ kind: "stopped", payload: event.payload });
      }),
    );
  }

  /** 确保后端进程已起来（Tauri 启动时已自动尝试，这里做兜底重试）。 */
  async ensureBackend(): Promise<void> {
    await this.boot();
    await invoke("backend_start");
  }

  /** 发一个请求并等待响应。 */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const id = this.nextId++;
    const payload: RpcRequest = { jsonrpc: "2.0", id, method, params };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });

    try {
      await invoke("rpc_send", { payload: JSON.stringify(payload) });
    } catch (err) {
      const entry = this.pending.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
      }
      throw new Error(`无法发送请求 ${method}：${String(err)}`);
    }

    return (await promise) as T;
  }

  /** 订阅事件推送。返回退订函数。 */
  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  /** 订阅后端进程状态变化。 */
  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  // ------------------------------------------------------------- 内部
  private handleLine(raw: string): void {
    // stderr 转发过来的行：只打日志，不进协议解析
    if (raw.includes('"__stderr__"')) {
      try {
        const parsed = JSON.parse(raw) as { __stderr__?: string };
        if (parsed.__stderr__) console.warn("[sidecar]", parsed.__stderr__);
      } catch {
        console.warn("[sidecar]", raw);
      }
      return;
    }

    let message: InboundMessage;
    try {
      message = JSON.parse(raw) as InboundMessage;
    } catch {
      console.warn("[rpc] 无法解析的行：", raw);
      return;
    }

    if (isNotification(message)) {
      if (message.method === "ready" || message.method === "fatal") {
        this.emitStatus({ kind: message.method, payload: message.params });
      }
      for (const handler of this.notificationHandlers) handler(message);
      return;
    }

    this.settle(message as RpcResponse);
  }

  private settle(response: RpcResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(response.id);

    if (response.error) {
      entry.reject(new Error(`[${response.error.code}] ${response.error.message}`));
    } else {
      entry.resolve(response.result);
    }
  }

  private emitStatus(payload: unknown): void {
    for (const handler of this.statusHandlers) handler(payload);
  }

  /** 组件卸载时清理，避免监听器泄漏。 */
  dispose(): void {
    for (const off of this.unlisten) off();
    this.unlisten = [];
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("客户端已销毁"));
    }
    this.pending.clear();
    this.notificationHandlers.clear();
    this.statusHandlers.clear();
    this.booted = false;
  }
}

/** 全局单例 —— 整个应用共用一个连接。 */
export const rpc = new RpcClient();
