//! Python sidecar 的生命周期管理。
//!
//! 设计上把「进程管理」和「协议处理」分开：
//!
//! * [`SidecarManager`] —— 只负责把 Python 进程拉起来、喂它吃东西、收它吐出来的行
//! * [`stdin_tx`] / 事件 → 前端转发 —— 由 `lib.rs` 里的命令层负责
//!
//! 关键约束：**进程必须随宿主退出而退出**。Windows 上子进程不会自动跟随父进程，
//! 所以这里显式在 `kill()` 里做收尾，并且 `lib.rs` 的 `RunEvent::Exit` 会调用它，
//! 避免留下孤儿 Python 进程。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex};

/// Windows 的 CREATE_NO_WINDOW 标志，避免拉起子进程时闪出控制台窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// sidecar 向外发出的两类信息。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SidecarOutput {
    /// 一行完整输出（已是 JSON 文本）
    Line { text: String },
    /// 进程结束（stdout 关闭）
    Exit { code: Option<i32> },
}

/// 后端当前状态，供前端顶栏展示。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub python: String,
}

/// 一条候选启动命令。
struct Candidate {
    program: String,
    args: Vec<String>,
}

/// 管理 Python sidecar 的单例。
pub struct SidecarManager {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    python: Mutex<String>,
    /// 工作目录（= 仓库根），sidecar 需要它才能找到 configs/ 与 .sessions/
    root: PathBuf,
}

impl SidecarManager {
    pub fn new(root: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            python: Mutex::new(String::new()),
            root,
        })
    }

    /// 启动 sidecar；`tx` 用于把输出行推回给调用方。
    pub async fn start(
        self: &Arc<Self>,
        tx: mpsc::UnboundedSender<SidecarOutput>,
    ) -> Result<SidecarStatus, String> {
        self.kill().await;

        let candidates = self.candidates();
        let mut last_error = String::from("未找到可用的 Python 解释器");

        for candidate in candidates {
            let mut cmd = Command::new(&candidate.program);
            cmd.args(&candidate.args)
                .current_dir(&self.root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true);

            // Windows：CREATE_NO_WINDOW —— 拉起 Python 时不闪控制台黑框
            // 注意：tokio::process::Command 自带 creation_flags，无需引入 std 的 CommandExt
            #[cfg(windows)]
            {
                cmd.creation_flags(CREATE_NO_WINDOW);
            }

            match cmd.spawn() {
                Ok(mut child) => {
                    let pid = child.id();
                    // 用 take() 而不是直接移动字段 —— 直接 `let stdin = child.stdin`
                    // 会把 child 部分移走，之后就再也不能整体存进 self.child 了
                    let stdin = child.stdin.take();
                    let stdout = child.stdout.take();
                    let stderr = child.stderr.take();

                    *self.child.lock().await = Some(child);
                    *self.stdin.lock().await = stdin;
                    *self.python.lock().await = candidate.program.clone();

                    if let Some(out) = stdout {
                        spawn_reader(out, tx.clone());
                    }
                    if let Some(err) = stderr {
                        // stderr 只用于诊断，转成带前缀的行，避免污染协议信道
                        spawn_stderr_reader(err, tx.clone());
                    }

                    return Ok(SidecarStatus {
                        running: true,
                        pid,
                        python: candidate.program,
                    });
                }
                Err(err) => {
                    last_error = format!("{} 启动失败：{err}", candidate.program);
                }
            }
        }

        Err(last_error)
    }

    /// 往 sidecar 的 stdin 写一行（自动补换行）。
    pub async fn write_line(&self, line: &str) -> Result<(), String> {
        let mut guard = self.stdin.lock().await;
        let stdin = guard.as_mut().ok_or_else(|| "sidecar 未运行".to_string())?;
        let mut payload = line.to_string();
        if !payload.ends_with('\n') {
            payload.push('\n');
        }
        stdin
            .write_all(payload.as_bytes())
            .await
            .map_err(|e| format!("写入 sidecar 失败：{e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("刷新 sidecar 失败：{e}"))?;
        Ok(())
    }

    pub async fn status(&self) -> SidecarStatus {
        let mut guard = self.child.lock().await;
        let (running, pid) = match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => (false, None),
                Ok(None) => (true, child.id()),
                Err(_) => (false, None),
            },
            None => (false, None),
        };
        SidecarStatus {
            running,
            pid,
            python: self.python.lock().await.clone(),
        }
    }

    /// 关闭子进程并清理句柄（异步版，用于正常的命令路径）。
    pub async fn kill(&self) {
        *self.stdin.lock().await = None;
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    /// 同步关闭 —— 只给**应用退出**路径用。
    ///
    /// 退出阶段不能 `await`（异步运行时可能已经在收尾），所以这里用
    /// `start_kill()` 发信号而不等待收割；`kill_on_drop(true)` 会在
    /// `Child` 被丢弃时兜底，确保不会留下孤儿 Python 进程。
    pub fn kill_blocking(&self) {
        if let Ok(mut guard) = self.child.try_lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.start_kill();
            }
        }
        if let Ok(mut guard) = self.stdin.try_lock() {
            *guard = None;
        }
    }

    /// 按优先级构造候选启动命令。
    ///
    /// 顺序很重要：优先用仓库自带的虚拟环境，保证依赖与开发环境一致；
    /// 找不到就回退到 PATH 上的 `ops-agent-bridge`，最后是裸 `python -m`。
    fn candidates(&self) -> Vec<Candidate> {
        let mut out = Vec::new();

        let venv = self.root.join(".venv");
        for rel in ["Scripts/python.exe", "bin/python"] {
            let p = venv.join(rel);
            if p.exists() {
                out.push(Candidate {
                    program: p.to_string_lossy().to_string(),
                    args: vec![
                        "-u".into(), // 无缓冲：实时事件必须立刻可读
                        "-m".into(),
                        "ops_agent.bridge.sidecar".into(),
                    ],
                });
                break;
            }
        }

        if let Some(p) = which::which("ops-agent-bridge").ok() {
            out.push(Candidate {
                program: p.to_string_lossy().to_string(),
                args: vec!["-u".into()],
            });
        }

        if let Some(p) = find_on_path(&["python", "python3", "py"]).ok() {
            out.push(Candidate {
                program: p,
                args: vec!["-u".into(), "-m".into(), "ops_agent.bridge.sidecar".into()],
            });
        }

        out
    }
}

/// 在 PATH 上找一个存在的可执行文件。
fn find_on_path(names: &[&str]) -> Result<String, ()> {
    for name in names {
        if let Ok(p) = which::which(name) {
            return Ok(p.to_string_lossy().to_string());
        }
    }
    Err(())
}

/// 逐行读 stdout —— 每一行都是协议消息。
fn spawn_reader<R>(reader: R, tx: mpsc::UnboundedSender<SidecarOutput>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(text)) = lines.next_line().await {
            if text.trim().is_empty() {
                continue;
            }
            if tx.send(SidecarOutput::Line { text }).is_err() {
                break;
            }
        }
        let _ = tx.send(SidecarOutput::Exit { code: None });
    });
}

/// 逐行读 stderr，加前缀后一并回传（供开发者排查）。
fn spawn_stderr_reader<R>(reader: R, tx: mpsc::UnboundedSender<SidecarOutput>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(text)) = lines.next_line().await {
            if text.trim().is_empty() {
                continue;
            }
            let _ = tx.send(SidecarOutput::Line {
                text: format!("{{\"__stderr__\":{}}}", json_string(&text)),
            });
        }
    });
}

/// 最小 JSON 字符串转义 —— 只为了把 stderr 安全地塞进一行。
fn json_string(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 2);
    out.push('"');
    for ch in raw.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// 推断仓库根目录。
///
/// 开发时 cwd 是 `desktop/src-tauri`，需要往上找到含 `configs/` 的那一层；
/// 打包后则以可执行文件旁边为准。
pub fn resolve_root() -> PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(root) = walk_up(&cwd) {
            return root;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Some(root) = walk_up(dir) {
                return root;
            }
        }
    }
    PathBuf::from(".")
}

/// 向上逐级查找带 `configs/` 与 `src/ops_agent` 特征的目录。
fn walk_up(start: &Path) -> Option<PathBuf> {
    let mut cur = Some(start);
    while let Some(dir) = cur {
        if dir.join("configs").is_dir() && dir.join("src").join("ops_agent").is_dir() {
            return Some(dir.to_path_buf());
        }
        cur = dir.parent();
    }
    None
}
