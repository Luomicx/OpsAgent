import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import { usePersistedConfig } from "./lib/config";
import { rpc } from "./lib/rpc";
import { toTimelineEntry } from "./lib/timeline";
import type {
  AgentResult,
  BackendStatus,
  ConnectionState,
  PermissionDecision,
  PermissionReport,
  RunOptions,
  TimelineEntry,
} from "./lib/types";
import { CommandChecker } from "./components/CommandChecker";
import { PermissionPanel } from "./components/PermissionPanel";
import { Sidebar } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";
import { TopBar } from "./components/TopBar";

type TabKey = "timeline" | "permission" | "checker";

export default function App() {
  const { config, patch } = usePersistedConfig();
  const [prompt, setPrompt] = useState("");

  // --- 后端连接 ---
  const [conn, setConn] = useState<ConnectionState>("connecting");
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [backendError, setBackendError] = useState("");
  const [python, setPython] = useState("");
  const [pid, setPid] = useState<number | undefined>(undefined);

  // --- 诊断 ---
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AgentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState("");

  // --- 权限页 ---
  const [tab, setTab] = useState<TabKey>("timeline");
  const [report, setReport] = useState<PermissionReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");

  // --- 校验器 ---
  const [checkResult, setCheckResult] = useState<{
    command: string;
    decision: PermissionDecision;
  } | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkError, setCheckError] = useState("");

  const options: RunOptions = useMemo(() => ({ ...config, prompt }), [config, prompt]);

  const refreshProcess = useCallback(async () => {
    try {
      const proc = await api.process();
      setPython(proc.python);
      setPid(proc.pid);
    } catch {
      // 进程信息拿不到不影响主流程，顶栏留空即可
    }
  }, []);

  // ------------------------------------------------------------ 事件订阅
  useEffect(() => {
    let disposed = false;

    const offNotification = rpc.onNotification((notification) => {
      if (disposed) return;

      // run 的开始/结束 —— 驱动按钮的 loading 态
      if (notification.method === "run.state") {
        setBusy(notification.params.state === "running");
        return;
      }

      if (notification.method !== "event") return;

      const { type, ts, data } = notification.params as {
        type: string;
        ts: number;
        data: Record<string, unknown>;
      };

      const entry = toTimelineEntry(type, data ?? {}, ts ?? Date.now() / 1000);
      if (!entry) return;

      setEntries((prev) => [...prev, entry]);

      // 拦截事件自动展开 —— 最需要被看见的就是它
      if (entry.kind === "denied") {
        setExpanded((prev) => new Set(prev).add(entry.id));
      }
    });

    const offStatus = rpc.onStatus((payload) => {
      if (disposed) return;
      const event = payload as { kind: string; payload: unknown };

      switch (event.kind) {
        case "ready":
          setConn("ready");
          setStatus(event.payload as BackendStatus);
          setBackendError("");
          void refreshProcess();
          break;
        case "error":
          setConn("error");
          setBackendError(String(event.payload));
          break;
        case "stopped":
          setConn("stopped");
          break;
        default:
          break;
      }
    });

    // 挂载 → 拉起后端（Tauri 启动时也试过一次，这里是幂等兜底）
    void (async () => {
      try {
        await rpc.ensureBackend();
        if (disposed) return;
        setStatus(await api.status());
        setConn("ready");
        await refreshProcess();
      } catch (err) {
        if (!disposed) {
          setConn("error");
          setBackendError(String(err));
        }
      }
    })();

    return () => {
      disposed = true;
      offNotification();
      offStatus();
    };
  }, [refreshProcess]);

  // 适配器切换 → 重建 Kernel
  useEffect(() => {
    if (conn !== "ready") return;
    api
      .configure({ adapter: config.adapter })
      .then(setStatus)
      .catch(() => undefined);
  }, [conn, config.adapter]);

  // ------------------------------------------------------------ 动作
  const runDiagnosis = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;

    setEntries([]);
    setExpanded(new Set());
    setResult(null);
    setRunError("");
    setBusy(true);
    setTab("timeline");

    try {
      const outcome = await api.run({
        host: config.host || "unknown-host",
        user: config.user,
        prompt: trimmed,
      });
      setResult(outcome);
      if (outcome.status) setStatus(outcome.status);
    } catch (err) {
      setRunError(String(err));
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, config.host, config.user]);

  const cancelRun = useCallback(async () => {
    try {
      await api.cancel();
    } catch {
      // 取消失败不阻断 UI；run 自身还有超时兜底
    } finally {
      setBusy(false);
    }
  }, []);

  const loadPermission = useCallback(async () => {
    setReportLoading(true);
    setReportError("");
    try {
      setReport(await api.permission());
    } catch (err) {
      setReportError(String(err));
    } finally {
      setReportLoading(false);
    }
  }, []);

  const checkCommand = useCallback(
    async (command: string) => {
      setCheckBusy(true);
      setCheckError("");
      try {
        setCheckResult(await api.checkCommand(command, config.host));
      } catch (err) {
        setCheckError(String(err));
        setCheckResult(null);
      } finally {
        setCheckBusy(false);
      }
    },
    [config.host],
  );

  const restartBackend = useCallback(async () => {
    setConn("connecting");
    setBackendError("");
    try {
      await rpc.ensureBackend();
      setStatus(await api.status());
      setConn("ready");
      await refreshProcess();
    } catch (err) {
      setConn("error");
      setBackendError(String(err));
    }
  }, [refreshProcess]);

  const toggleEntry = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 切到权限页时惰性加载
  useEffect(() => {
    if (tab === "permission" && !report && !reportLoading) {
      void loadPermission();
    }
  }, [tab, report, reportLoading, loadPermission]);

  const deniedCount = entries.filter((e) => e.kind === "denied").length;

  return (
    <div className="app">
      <TopBar state={conn} status={status} python={python} pid={pid} />

      {conn === "error" && (
        <div className="banner error">
          <span>后端未能启动：{backendError}</span>
          <span className="spacer" />
          <button className="btn sm" onClick={restartBackend}>
            重试
          </button>
        </div>
      )}

      <div className="app-body">
        <Sidebar
          options={options}
          onChange={(next) => {
            if (next.adapter !== undefined) patch({ adapter: next.adapter });
            if (next.host !== undefined) patch({ host: next.host });
            if (next.user !== undefined) patch({ user: next.user });
            if (next.prompt !== undefined) setPrompt(next.prompt);
          }}
          status={status}
          state={conn}
          busy={busy}
          onRun={runDiagnosis}
          onCancel={cancelRun}
          onRestart={restartBackend}
        />

        <main className="main">
          <div className="tabs">
            <button
              className={`tab ${tab === "timeline" ? "active" : ""}`}
              onClick={() => setTab("timeline")}
            >
              执行时间线
              {entries.length > 0 && <span className="tab-badge">{entries.length}</span>}
            </button>
            <button
              className={`tab ${tab === "permission" ? "active" : ""}`}
              onClick={() => setTab("permission")}
            >
              权限分层
              {report && <span className="tab-badge">{report.totalRules}</span>}
            </button>
            <button
              className={`tab ${tab === "checker" ? "active" : ""}`}
              onClick={() => setTab("checker")}
            >
              命令校验器
              {deniedCount > 0 && <span className="tab-badge alert">{deniedCount}</span>}
            </button>
          </div>

          <div className="tab-panel">
            {tab === "timeline" && (
              <>
                {runError && (
                  <div className="banner error">
                    <span>{runError}</span>
                  </div>
                )}

                {result && (
                  <div className="verdict">
                    <div className="verdict-head">
                      <span>结论</span>
                      {result.deniedCount > 0 && (
                        <span
                          style={{
                            color: "var(--danger)",
                            letterSpacing: 0,
                            textTransform: "none",
                            fontWeight: 500,
                          }}
                        >
                          · 本次拦截 {result.deniedCount} 次
                        </span>
                      )}
                      {!result.finished && (
                        <span
                          style={{
                            color: "var(--warn)",
                            letterSpacing: 0,
                            textTransform: "none",
                            fontWeight: 500,
                          }}
                        >
                          · 达到最大步数
                        </span>
                      )}
                    </div>
                    <div className="verdict-text">{result.text}</div>
                  </div>
                )}

                <Timeline entries={entries} expanded={expanded} onToggle={toggleEntry} />
              </>
            )}

            {tab === "permission" && (
              <PermissionPanel
                report={report}
                loading={reportLoading}
                error={reportError}
              />
            )}

            {tab === "checker" && (
              <CommandChecker
                result={checkResult}
                busy={checkBusy}
                error={checkError}
                onCheck={checkCommand}
                onClear={() => {
                  setCheckResult(null);
                  setCheckError("");
                }}
              />
            )}
          </div>

          {tab === "timeline" && (
            <div className="composer">
              <textarea
                value={prompt}
                placeholder="下达一条只读诊断指令，例如：看看这台机器磁盘和内存使用情况"
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void runDiagnosis();
                  }
                }}
                disabled={busy}
              />
              <div className="composer-actions">
                <button
                  className="btn primary"
                  disabled={!prompt.trim() || busy || conn !== "ready"}
                  onClick={runDiagnosis}
                >
                  {busy ? <span className="spinner" /> : "发送"}
                </button>
                <span
                  style={{ fontSize: 10.5, color: "var(--text-faint)", textAlign: "center" }}
                >
                  Ctrl/⌘ + ↵
                </span>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
