import type {
  AgentResult,
  BackendStatus,
  ConnectionState,
  RunOptions,
  TimelineEntry,
} from './types';
import type { ScreenId } from './nav';
import type { PersistedConfig } from './config';

/**
 * 全局上下文。只放**跨屏共享**的状态与动作；
 * 各屏自己的数据（权限报告、校验结果、审计事件）由屏幕内部自行获取，
 * 避免这个类型无限膨胀。
 */
export interface AppCtx {
  /* ---------------- 连接 ---------------- */
  conn: ConnectionState;
  status: BackendStatus | null;
  python: string;
  pid?: number;
  backendError: string;

  /* ---------------- 会话 / 时间线 ---------------- */
  entries: TimelineEntry[];
  expanded: Set<string>;
  toggleEntry: (id: string) => void;
  result: AgentResult | null;
  busy: boolean;
  runError: string;

  /* ---------------- 输入与配置 ---------------- */
  prompt: string;
  setPrompt: (v: string) => void;
  options: RunOptions;
  config: PersistedConfig;
  patchConfig: (next: Partial<PersistedConfig>) => void;

  /* ---------------- 导航 ---------------- */
  screen: ScreenId;
  go: (id: ScreenId) => void;

  /* ---------------- 动作 ---------------- */
  run: () => Promise<void>;
  cancel: () => Promise<void>;
  restartBackend: () => Promise<void>;
}
