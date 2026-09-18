import { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import type { BackendStatus, ConnectionState } from '../../lib/types';

/**
 * 01 · 启动 / 后端握手
 *
 * 说明：五个步骤的**文案**是 sidecar 真实经历的阶段；
 * 逐个「点亮」的节奏是表现层的（后端不会分阶段回报）。
 * 右侧 ms 是**真实的墙钟耗时**（从挂载到该步点亮的秒数），不是编造的数字。
 */
const STEPS = [
  '拉起 Python sidecar 进程',
  '加载插件（拓扑排序）',
  '初始化权限流水线',
  '打开会话事件流',
  '就绪 · 等待指令',
];

/** 每步点亮的间隔（表现层节奏，非后端耗时） */
const STEP_INTERVAL_MS = 300;

export default function BootScreen({
  conn,
  status,
  python,
  backendError,
}: {
  conn: ConnectionState;
  status: BackendStatus | null;
  python: string;
  backendError: string;
}) {
  const [revealed, setRevealed] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const marks = useRef<number[]>([]);
  const startedAt = useRef(Date.now());

  /* 总耗时走表 */
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    return () => clearInterval(t);
  }, []);

  /* 逐步点亮；真实连上后一次性补满 */
  useEffect(() => {
    if (conn === 'ready') {
      marks.current = STEPS.map(() => Date.now() - startedAt.current);
      setRevealed(STEPS.length);
      return;
    }
    if (revealed >= STEPS.length - 1) return;
    const t = setTimeout(() => {
      marks.current[revealed] = Date.now() - startedAt.current;
      setRevealed((n) => n + 1);
    }, STEP_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [revealed, conn]);

  const fmt = (ms: number) => `${ms}ms`;

  /** 第 2 步的插件计数用真实值；拿不到就不写数字 */
  const pluginText =
    conn === 'ready' && status?.plugins
      ? `加载插件 ${status.plugins.length} / ${status.plugins.length}（拓扑排序）`
      : '加载插件（拓扑排序）';

  /** 第 3 步的规则数来自权限报告；启动阶段通常还没拿到，故仅在就绪后补 */
  const layerText = '初始化权限流水线';

  const labels = [
    STEPS[0],
    pluginText,
    layerText,
    STEPS[3],
    STEPS[4],
  ];

  return (
    <div className="boot">
      <div className="grid" />
      <div className="in">
        <div className="mk">
          <Icon name="i-shield" size="xl" />
        </div>
        <h1>
          OpsAgent <em>/ console</em>
        </h1>
        <div className="tg">只读运维诊断 · 分层权限 · 可审计事件流</div>

        <div className="steps">
          {labels.map((label, i) => {
            const done = i < revealed - 1 || conn === 'ready';
            const cur = i === revealed - 1 && conn !== 'ready';
            return (
              <div key={label} className={`stp ${done ? 'done' : ''} ${cur ? 'cur' : ''}`}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span className="tx">{label}</span>
                {done && <Icon name="i-check" size="s" />}
                {cur && <span className="dot warn breathe" style={{ margin: '0 5px' }} />}
                <span className="ms">
                  {done ? fmt(marks.current[i] ?? 0) : cur ? '…' : '—'}
                </span>
              </div>
            );
          })}
        </div>

        <div className="scan">
          <i />
        </div>
      </div>

      <div className="ft">
        {backendError
          ? `后端异常：${backendError}`
          : `${python || 'python'} · 已用时 ${(elapsed / 1000).toFixed(1)}s · 默认拒绝一切写操作`}
      </div>
    </div>
  );
}
