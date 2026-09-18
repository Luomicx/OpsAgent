//! Tauri 应用装配：命令注册、sidecar 启停、事件转发。
//!
//! 前端从不直接碰进程或管道 —— 它只调几个命令（`rpc_send` / `backend_status` / …）
//! 并监听事件（`rpc://message`、`backend://status`）。所有进程细节封在这一层。
//!
//! 一个容易踩的坑：`app.state::<T>()` 返回的是**借用**，把它捕获进
//! `tauri::async_runtime::spawn` 的 `'static` future 会编译不过。
//! 因此跨任务共享的东西都先做成可克隆的句柄
//! （`Arc<SidecarManager>`、`Arc<Mutex<Receiver>>`、`AppHandle`），
//! 任务只捕获这些 owned 克隆。

mod sidecar;

use std::sync::Arc;

use sidecar::{resolve_root, SidecarManager, SidecarOutput, SidecarStatus};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tokio::sync::{mpsc, Mutex};

/// 全局状态。
struct AppState {
    manager: Arc<SidecarManager>,
    /// 写出端：命令层用它给 sidecar 发消息
    sender: mpsc::UnboundedSender<SidecarOutput>,
    /// 是否已尝试过启动（供前端的重试按钮参考）
    started: Mutex<bool>,
}

/// 前端调用的命令：把一行 JSON 发给 sidecar。
#[tauri::command]
async fn rpc_send(state: State<'_, AppState>, payload: String) -> Result<(), String> {
    state.manager.write_line(&payload).await
}

/// 前端调用的命令：查询后端状态。
#[tauri::command]
async fn backend_status(state: State<'_, AppState>) -> Result<SidecarStatus, String> {
    Ok(state.manager.status().await)
}

/// 前端调用的命令：拉起后端（首次自动调用，失败后可手动重试）。
#[tauri::command]
async fn backend_start(state: State<'_, AppState>) -> Result<SidecarStatus, String> {
    let status = state.manager.start(state.sender.clone()).await?;
    *state.started.lock().await = true;
    Ok(status)
}

/// 前端调用的命令：停止后端。
#[tauri::command]
async fn backend_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.manager.kill().await;
    *state.started.lock().await = false;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = resolve_root();
    let manager = SidecarManager::new(root);

    // 先建好通道并取出可克隆的两端，供后续跨任务使用
    let (sender, receiver) = mpsc::unbounded_channel::<SidecarOutput>();
    let receiver = Arc::new(Mutex::new(receiver));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            manager: manager.clone(),
            sender: sender.clone(),
            started: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            rpc_send,
            backend_status,
            backend_start,
            backend_stop
        ])
        .setup(move |app| {
            let handle: AppHandle = app.handle().clone();

            // --- 自动拉起后端 ---
            // 失败不阻塞窗口：前端会显示「后端异常」并给出重试入口
            let mgr = manager.clone();
            let tx = sender.clone();
            let boot_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                match mgr.start(tx).await {
                    Ok(status) => {
                        let _ = boot_handle.emit("backend://status", status);
                    }
                    Err(err) => {
                        let _ = boot_handle.emit("backend://error", err);
                    }
                }
            });

            // --- 事件泵：把 sidecar 的输出行转成 Tauri 事件发给前端 ---
            // 捕获的全是 owned 克隆，因此这个 future 满足 'static
            let receiver = receiver.clone();
            tauri::async_runtime::spawn(async move {
                let mut rx = receiver.lock().await;
                while let Some(output) = rx.recv().await {
                    match output {
                        SidecarOutput::Line { text } => {
                            let _ = handle.emit("rpc://message", text);
                        }
                        SidecarOutput::Exit { code } => {
                            let _ = handle.emit("backend://exit", code);
                        }
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("构建 Tauri 应用失败")
        .run(|app_handle, event| {
            // 宿主退出时同步杀掉 Python 子进程，避免留下孤儿。
            // 这里必须**同步**收尾：退出阶段不能再假设异步运行时还活着。
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.manager.kill_blocking();
                }
            }
        });
}
