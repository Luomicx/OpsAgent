import { windowAction } from '../../lib/bridge';
import Icon from '../ui/Icon';
import type { ConnectionState } from '../../lib/types';

/**
 * 自绘标题栏（重构计划 §8 方案 A）。
 *
 * 为什么自绘：设计稿的 `.win` 含 42px 标题栏；若保留系统装饰会多出一条，
 * 导致内容区高度对不上，破坏 1:1。
 *
 * 窗口控制由 macOS 风格的红黄绿点承担（最小化 / 最大化 / 关闭），
 * 因此右侧不再重复放一套 Windows 按钮 —— 既保持设计稿观感，
 * 又不牺牲功能。浏览器预览下这些点无副作用。
 */
function trafficLight(kind: 'r' | 'y' | 'g', title: string, action: () => void) {
  return <i key={kind} className={`${kind} clickable`} title={title} onClick={action} />;
}

export default function WindowChrome({
  title,
  conn,
  pid,
  python,
  backendError,
}: {
  title: string;
  conn: ConnectionState;
  pid?: number;
  python?: string;
  backendError?: string;
}) {
  return (
    <div className="chrome" data-tauri-drag-region>
      <span className="lt">
        {trafficLight('r', '关闭', () => void windowAction('close'))}
        {trafficLight('y', '最小化', () => void windowAction('minimize'))}
        {trafficLight('g', '最大化', () => void windowAction('toggleMaximize'))}
      </span>

      <span className="ti" data-tauri-drag-region>
        <b>OpsAgent</b> — {title}
      </span>

      <span className="sp" data-tauri-drag-region />

      <span className="rt">
        {conn === 'ready' && (
          <span className="tag ok" title={python ? `解释器：${python}` : undefined}>
            <span className="dot ok breathe" />
            后端就绪{pid ? ` · PID ${pid}` : ''}
          </span>
        )}
        {conn === 'connecting' && (
          <span className="tag info">
            <span className="dot warn breathe" />
            正在连接后端
          </span>
        )}
        {conn === 'error' && (
          <span className="tag bad" title={backendError}>
            <span className="dot bad" />
            sidecar 已退出
          </span>
        )}
        {conn === 'stopped' && (
          <span className="tag mut">
            <span className="dot mut" />
            已停止
          </span>
        )}
      </span>
    </div>
  );
}

/** 标题栏右侧的自定义插槽（各屏可注入额外状态） */
export function ChromeActions({ children }: { children: React.ReactNode }) {
  return <span className="rt">{children}</span>;
}

/** 供页面复用的「返回」按钮 */
export function BackButton({ onClick, label = '返回' }: { onClick: () => void; label?: string }) {
  return (
    <button className="btn gh sm" style={{ height: 30 }} onClick={onClick}>
      <Icon name="i-chev-l" size="s" />
      {label}
    </button>
  );
}
