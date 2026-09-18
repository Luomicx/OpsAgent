/**
 * 宿主桥：把 Tauri IPC 抽象成一层薄接口。
 *
 * 为什么要这一层：让 `rpc.ts` 不直接依赖 `@tauri-apps/api`，
 * 从而可以在浏览器里挂上预览实现（见 `preview.ts`）。
 *
 * 生产构建里 `previewEnabled()` 恒为 false（依赖 `import.meta.env.DEV`），
 * 预览代码会被摇树移除。
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { previewEnabled, previewInvoke, previewListen } from './preview';

export type { UnlistenFn };

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (previewEnabled()) return previewInvoke(cmd, args) as Promise<T>;
  return tauriInvoke<T>(cmd, args);
}

export async function listen<T>(
  event: string,
  cb: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (previewEnabled()) return previewListen(event, cb as (e: { payload: unknown }) => void);
  return tauriListen<T>(event, cb);
}

/** 窗口控制。浏览器预览下没有真实窗口，静默忽略。 */
export async function windowAction(
  action: 'close' | 'minimize' | 'toggleMaximize',
): Promise<void> {
  if (previewEnabled()) return;
  try {
    const w = getCurrentWindow();
    if (action === 'close') await w.close();
    else if (action === 'minimize') await w.minimize();
    else await w.toggleMaximize();
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}

/** 供界面提示用：当前是否处于浏览器预览 */
export const isPreview = previewEnabled;
