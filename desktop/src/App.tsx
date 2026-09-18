import { useCallback, useEffect, useMemo, useState } from 'react';
import WindowChrome from './components/chrome/WindowChrome';
import SideNav from './components/layout/SideNav';
import IconSprite from './components/ui/IconSprite';
import { api } from './lib/api';
import type { AppCtx } from './lib/appCtx';
import { usePersistedConfig } from './lib/config';
import { SCREEN_META, type ScreenId } from './lib/nav';
import { rpc } from './lib/rpc';
import { toTimelineEntry } from './lib/timeline';
import type {
  AgentResult,
  BackendStatus,
  ConnectionState,
  RunOptions,
  TimelineEntry,
} from './lib/types';

import BootScreen from './components/screens/BootScreen';
import DisconnectedScreen from './components/screens/DisconnectedScreen';
import OverviewScreen from './components/screens/OverviewScreen';
import TimelineScreen from './components/screens/TimelineScreen';
import ReportScreen from './components/screens/ReportScreen';
import PermissionScreen from './components/screens/PermissionScreen';
import CheckerScreen from './components/screens/CheckerScreen';
import AuditScreen from './components/screens/AuditScreen';
import HostsScreen from './components/screens/HostsScreen';
import KernelScreen from './components/screens/KernelScreen';
import AdaptersScreen from './components/screens/AdaptersScreen';
import RulesScreen from './components/screens/RulesScreen';
import SettingsScreen from './components/screens/SettingsScreen';

/** 从 URL hash 读初始屏（支持 #/permissions 这样的深链，也方便逐屏截图校对） */
function screenFromHash(): ScreenId {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  const valid: ScreenId[] = [
    'overview', 'run', 'report', 'permissions', 'rules', 'checker',
    'audit', 'hosts', 'kernel', 'adapters', 'settings',
  ];
  return (valid as string[]).includes(raw) ? (raw as ScreenId) : 'overview';
}

export default function App() {
  const { config, patch } = usePersistedConfig();
  const [screen, setScreen] = useState<ScreenId>(screenFromHash);
  const [prompt, setPrompt] = useState('');

  /* ---------------- 连接 ---------------- */
  const [conn, setConn] = useState<ConnectionState>('connecting');
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [backendError, setBackendError] = useState('');
  const [python, setPython] = useState('');
  const [pid, setPid] = useState<number | undefined>(undefined);
  /** 是否曾经成功连接过 —— 决定显示启动页还是直接进主界面 */
  const [everReady, setEverReady] = useState(false);

  /* ---------------- 会话 ---------------- */
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AgentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState('');

  const options: RunOptions = useMemo(() => ({ ...config, prompt }), [config, prompt]);

  const refreshProcess = useCallback(async () => {
    try {
      const proc = await api.process();
      setPython(proc.python);
      setPid(proc.pid);
    } catch {
      /* 进程信息拿不到不影响主流程 */
    }
  }, []);

  /* ---------------- 事件订阅 ---------------- */
  useEffect(() => {
    let disposed = false;

    const offNotification = rpc.onNotification((notification) => {
      if (disposed) return;

      if (notification.method === 'run.state') {
        setBusy(notification.params.state === 'running');
        return;
      }
      if (notification.method !== 'event') return;

      const { type, ts, data } = notification.params as {
        type: string;
        ts: number;
        data: Record<string, unknown>;
      };
      const entry = toTimelineEntry(type, data ?? {}, ts ?? Date.now() / 1000);
      if (!entry) return;

      setEntries((prev) => [...prev, entry]);
      // 拦截事件自动展开 —— 最需要被看见的就是它
      if (entry.kind === 'denied') {
        setExpanded((prev) => new Set(prev).add(entry.id));
      }
    });

    const offStatus = rpc.onStatus((payload) => {
      if (disposed) return;
      const event = payload as { kind: string; payload: unknown };
      switch (event.kind) {
        case 'ready':
          setConn('ready');
          setStatus(event.payload as BackendStatus);
          setBackendError('');
          setEverReady(true);
          void refreshProcess();
          break;
        case 'error':
          setConn('error');
          setBackendError(String(event.payload));
          break;
        case 'stopped':
          setConn('stopped');
          break;
        default:
          break;
      }
    });

    void (async () => {
      try {
        await rpc.ensureBackend();
        if (disposed) return;
        setStatus(await api.status());
        setConn('ready');
        setEverReady(true);
        await refreshProcess();
      } catch (err) {
        if (!disposed) {
          setConn('error');
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

  /* 适配器切换 → 重建 Kernel（事件订阅由可逆副作用自动撤销重挂） */
  useEffect(() => {
    if (conn !== 'ready') return;
    api
      .configure({ adapter: config.adapter })
      .then(setStatus)
      .catch(() => undefined);
  }, [conn, config.adapter]);

  /* ---------------- 动作 ---------------- */
  const run = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;

    setEntries([]);
    setExpanded(new Set());
    setResult(null);
    setRunError('');
    setBusy(true);
    setScreen('run');

    try {
      const outcome = await api.run({
        host: config.host || 'unknown-host',
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

  const cancel = useCallback(async () => {
    try {
      await api.cancel();
    } catch {
      /* 取消失败不阻断 UI；run 自身有超时兜底 */
    } finally {
      setBusy(false);
    }
  }, []);

  const restartBackend = useCallback(async () => {
    setConn('connecting');
    setBackendError('');
    try {
      await rpc.ensureBackend();
      setStatus(await api.status());
      setConn('ready');
      setEverReady(true);
      await refreshProcess();
    } catch (err) {
      setConn('error');
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

  /** 导航：同时同步到 URL hash，保证刷新/深链一致 */
  const go = useCallback((id: ScreenId) => {
    setScreen(id);
    window.location.hash = `#/${id}`;
  }, []);

  /* 浏览器前进/后退 */
  useEffect(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /* ---------------- 组装上下文 ---------------- */
  const ctx: AppCtx = {
    conn,
    status,
    python,
    pid,
    backendError,
    entries,
    expanded,
    toggleEntry,
    result,
    busy,
    runError,
    prompt,
    setPrompt,
    options,
    config,
    patchConfig: patch,
    screen,
    go,
    run,
    cancel,
    restartBackend,
  };

  /* ---------------- 侧栏徽标：只显示真实可得的数据 ---------------- */
  const denied = entries.filter((e) => e.eventType === 'permission.denied').length;
  const badges: Parameters<typeof SideNav>[0]['badges'] = {};
  if (status?.plugins?.length) badges.kernel = { text: String(status.plugins.length) };
  if (denied > 0) badges.audit = { text: String(denied), tone: 'bad' };

  /* ---------------- 分支渲染 ---------------- */
  // 启动阶段：连接中且从未成功过 → 全屏启动页（设计稿 01）
  if (!everReady && conn === 'connecting') {
    return (
      <div className="shell">
        <IconSprite />
        <WindowChrome title="正在启动" conn={conn} pid={pid} python={python} />
        <BootScreen conn={conn} status={status} python={python} backendError={backendError} />
      </div>
    );
  }

  const meta = SCREEN_META[screen];

  return (
    <div className="shell">
      <IconSprite />
      <WindowChrome
        title={meta.title}
        conn={conn}
        pid={pid}
        python={python}
        backendError={backendError}
      />
      <div className="app">
        <SideNav
          current={screen}
          onNavigate={go}
          badges={badges}
          version="v0.1.0"
          disabled={conn !== 'ready'}
        />
        {conn === 'error' && screen !== 'settings' ? (
          <DisconnectedScreen app={ctx} />
        ) : (
          <ScreenSwitch screen={screen} app={ctx} />
        )}
      </div>
    </div>
  );
}

function ScreenSwitch({ screen, app }: { screen: ScreenId; app: AppCtx }) {
  switch (screen) {
    case 'overview':
      return <OverviewScreen app={app} />;
    case 'run':
      return <TimelineScreen app={app} />;
    case 'report':
      return <ReportScreen app={app} />;
    case 'permissions':
      return <PermissionScreen app={app} />;
    case 'rules':
      return <RulesScreen app={app} />;
    case 'checker':
      return <CheckerScreen app={app} />;
    case 'audit':
      return <AuditScreen app={app} />;
    case 'hosts':
      return <HostsScreen app={app} />;
    case 'kernel':
      return <KernelScreen app={app} />;
    case 'adapters':
      return <AdaptersScreen app={app} />;
    case 'settings':
      return <SettingsScreen app={app} />;
    default:
      return <OverviewScreen app={app} />;
  }
}
