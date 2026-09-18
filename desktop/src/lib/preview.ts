/**
 * 浏览器预览桥（**仅开发模式**）
 *
 * 目的：让 UI 能在浏览器里直接打开审阅，不必先编译 Rust 外壳。
 * 它模拟的是一个「已经连上 Python 后端」的环境：把 `rpc_send`
 * 转成一组固定的 RPC 响应，并按剧本推送事件，使时间线看起来是活的。
 *
 * 两条硬边界：
 *   1. **只在 `import.meta.env.DEV` 且不在 Tauri 里生效** —— 生产构建会被
 *      摇树掉，绝不会把假数据带进真实应用
 *   2. 所有数值都明确标注为「预览数据」，界面上仍按 [PLACEHOLDER] 规则展示
 */

import type { PermissionReport, SessionEvent } from './types';

/** 是否运行在 Tauri 外壳里 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 是否启用预览桥 */
export function previewEnabled(): boolean {
  return import.meta.env.DEV && !isTauri();
}

type Payload = Record<string, unknown>;
interface MiniEvent {
  payload: unknown;
}

/* ---------------- 极简事件总线 ---------------- */
const bus = new Map<string, Set<(e: MiniEvent) => void>>();

export function previewEmit(event: string, payload: unknown): void {
  for (const cb of bus.get(event) ?? []) cb({ payload });
}

export async function previewListen(
  event: string,
  cb: (e: MiniEvent) => void,
): Promise<() => void> {
  if (!bus.has(event)) bus.set(event, new Set());
  bus.get(event)!.add(cb);
  return () => bus.get(event)!.delete(cb);
}

/* ---------------- 固定数据集 ---------------- */
const PLUGINS = [
  'session_store',
  'tool_registry',
  'permission_pipeline',
  'ssh_pool',
  'ssh_execute',
  'ssh_read_file',
  'ssh_list_dir',
  'mock_adapter',
  'agent_loop',
];

const TOOLS = ['ssh_execute', 'ssh_read_file', 'ssh_list_dir'];

const PERMISSION: PermissionReport = {
  totalRules: 121,
  layers: [
    {
      layer: 'L1',
      name: '全局黑名单',
      description: '正则 + 字面量双路匹配，抗变形写法',
      ruleCount: 34,
      rules: [
        { pattern: '/\\brm\\s+-[a-z]*[rf]/', kind: '正则', description: '删除类命令，含 -fr 等参数序变体' },
        { pattern: 'dd if=/dev/zero', kind: '字面量', description: '磁盘覆写' },
        { pattern: '/\\b(sudo|su|doas)\\b/', kind: '正则', description: '提权' },
        { pattern: '/\\|\\s*(sudo\\s+)?(sh|bash|zsh|python)\\b/', kind: '正则', description: '管道进 shell' },
        { pattern: '/\\b(shutdown|reboot|halt|poweroff)\\b/', kind: '正则', description: '关机 / 重启' },
        { pattern: '/\\bmkfs(\\.[a-z0-9]+)?\\b/', kind: '正则', description: '格式化文件系统' },
        { pattern: '/:\\s*\\(\\s*\\)\\s*\\{/', kind: '正则', description: 'fork 炸弹' },
        { pattern: '/\\bchmod\\b/', kind: '正则', description: '改权限' },
        { pattern: '//etc/ssh/sshd_config/', kind: '字面量', description: 'SSH 服务配置' },
      ],
    },
    {
      layer: 'L2',
      name: '命令白名单',
      description: '只放行只读命令；管道/串联的每一段都要单独过审',
      ruleCount: 79,
      rules: [
        { pattern: 'df', kind: '命令', description: '磁盘使用率' },
        { pattern: 'free', kind: '命令', description: '内存使用' },
        { pattern: 'ps', kind: '命令', description: '进程列表' },
        { pattern: 'top', kind: '命令', description: '必须带 -b（避免阻塞会话）' },
        { pattern: 'journalctl', kind: '命令', description: '建议带 --no-pager' },
        { pattern: 'ls', kind: '命令', description: '列目录' },
        { pattern: 'cat', kind: '命令', description: '读文件（⚠️ 无路径管控）' },
        { pattern: 'systemctl', kind: '命令', description: '只允许 status / is-active' },
      ],
    },
    {
      layer: 'L3',
      name: 'Shell 注入检测',
      description: '命令替换 / 重定向 / 串联 / 畸形引号',
      ruleCount: 8,
      rules: [
        { pattern: '$( )', kind: '元字符', description: '命令替换' },
        { pattern: '` `', kind: '元字符', description: '反引号命令替换' },
        { pattern: '< >', kind: '元字符', description: '输入输出重定向' },
        { pattern: '; && ||', kind: '元字符', description: '命令串联' },
        { pattern: '&', kind: '元字符', description: '后台执行' },
      ],
    },
  ],
};

/** 供预览使用的 mock 会话事件剧本 */
const SCRIPT: { type: string; data: Payload; delay: number }[] = [
  { delay: 60, type: 'session.start', data: { host: 'demo-host', adapter: 'mock' } },
  { delay: 120, type: 'agent.input', data: { input: '看看这台机器磁盘和内存使用情况' } },
  { delay: 140, type: 'agent.think', data: { step: 1, messages: 2 } },
  { delay: 160, type: 'tool.before', data: { tool: 'ssh_execute', command: 'df -h' } },
  { delay: 80, type: 'permission.allowed', data: { tool: 'ssh_execute', command: 'df -h', layer: 'ALL' } },
  { delay: 90, type: 'ssh.connect', data: { host: 'demo-host', user: 'root', dry_run: true } },
  { delay: 200, type: 'ssh.command', data: { command: 'df -h', length: 412 } },
  { delay: 120, type: 'tool.after', data: { tool: 'ssh_execute', ok: true, length: 412 } },
  { delay: 140, type: 'agent.think', data: { step: 2, messages: 6 } },
  { delay: 130, type: 'tool.before', data: { tool: 'ssh_execute', command: 'free -m' } },
  { delay: 80, type: 'permission.allowed', data: { tool: 'ssh_execute', command: 'free -m', layer: 'ALL' } },
  { delay: 180, type: 'tool.after', data: { tool: 'ssh_execute', ok: true, length: 286 } },
  { delay: 150, type: 'tool.before', data: { tool: 'ssh_execute', command: 'rm -rf /var/log/*' } },
  {
    delay: 70,
    type: 'permission.denied',
    data: {
      tool: 'ssh_execute',
      command: 'rm -rf /var/log/*',
      layer: 'L1',
      rule: '/\\brm\\s+-[a-z]*[rf]/',
      reason: "命令包含高危片段：'rm -rf /'",
    },
  },
  { delay: 90, type: 'tool.after', data: { tool: 'ssh_execute', ok: false, denied_by: 'L1' } },
  { delay: 110, type: 'context.compact', data: { keep: 20, dropped: 4 } },
  { delay: 160, type: 'agent.final', data: { step: 3, length: 186 } },
  { delay: 70, type: 'session.end', data: { events: 18, denied: 1 } },
];

let scriptTimers: ReturnType<typeof setTimeout>[] = [];
function stopScript() {
  for (const t of scriptTimers) clearTimeout(t);
  scriptTimers = [];
}

/** 按剧本推送事件；返回取消函数 */
function playScript(): void {
  stopScript();
  let acc = 0;
  for (const step of SCRIPT) {
    acc += step.delay;
    scriptTimers.push(
      setTimeout(() => {
        previewEmit('rpc://message', JSON.stringify({ jsonrpc: '2.0', method: 'event', params: step }));
      }, acc),
    );
  }
}

/* ---------------- 假的事件流落盘内容 ---------------- */
function mockEvents(): SessionEvent[] {
  let seq = 0;
  const now = Math.floor(Date.now() / 1000) - 600;
  return SCRIPT.map((s, i) => ({
    seq: ++seq,
    type: s.type,
    ts: now + i * 2,
    data: s.data,
  }));
}

const BACKEND_STATUS = {
  ready: true,
  adapter: 'mock',
  configPath: 'configs/default.yaml',
  sessionPath: '.sessions/session.jsonl',
  eventCount: 412,
  tools: TOOLS,
  plugins: PLUGINS,
  capabilities: {
    session_store: 'session_store',
    tool_registry: 'tool_registry',
    permission_pipeline: 'permission_pipeline',
    ssh_pool: 'ssh_pool',
    model_adapter: 'mock_adapter',
  },
  apiKeyPresent: false,
};

/* ---------------- RPC 路由 ---------------- */
function dispatch(method: string, params: Payload): unknown {
  switch (method) {
    case 'ping':
      return { pong: true, ready: true, adapter: 'mock' };
    case 'status':
      return BACKEND_STATUS;
    case 'configure':
      return { ...BACKEND_STATUS, adapter: (params.adapter as string) ?? 'mock' };
    case 'permission':
      return PERMISSION;
    case 'replay':
      return { path: '.sessions/session.jsonl', events: mockEvents(), integrity: true };
    case 'checkCommand': {
      const command = String(params.command ?? '');
      const denied = /rm\s+-[a-z]*[rf]/.test(command) || /;\s*\w/.test(command) || /\$\(/.test(command);
      const l2 = /^\s*top\s*$/.test(command);
      return {
        command,
        decision: denied
          ? {
              allowed: false,
              layer: /rm\s+-[a-z]*[rf]/.test(command) ? 'L1' : 'L3',
              reason: /rm\s+-[a-z]*[rf]/.test(command)
                ? "命令包含高危片段：'rm -rf /'"
                : '检测到 shell 注入元字符',
              rule: /rm\s+-[a-z]*[rf]/.test(command) ? '/\\brm\\s+-[a-z]*[rf]/' : '命令串联 / 替换',
            }
          : l2
            ? { allowed: false, layer: 'L2', reason: "命令 'top' 必须带参数 '-b'（避免阻塞会话）", rule: 'top 约束' }
            : { allowed: true, layer: 'ALL', reason: '通过全部 3 层校验', rule: '' },
      };
    }
    case 'run':
      playScript();
      return {
        text:
          '该主机磁盘使用率正常，根分区已用 62%（剩余 19G），内存占用 41%，无 swap 交换。\n' +
          '期间检测到一次高危写操作尝试（rm -rf /var/log/*）已被 L1 全局黑名单拦截，未执行。\n' +
          '建议保持当前运行状态，无需干预。',
        finished: true,
        stepsUsed: 3,
        deniedCount: 1,
        steps: [
          { tool: 'ssh_execute', command: 'df -h', args: {}, allowed: true, denied: false, layer: 'ALL', reason: '', output: 'Filesystem ... 19G', outputLength: 412 },
          { tool: 'ssh_execute', command: 'free -m', args: {}, allowed: true, denied: false, layer: 'ALL', reason: '', output: 'Mem: ...', outputLength: 286 },
          { tool: 'ssh_execute', command: 'rm -rf /var/log/*', args: {}, allowed: false, denied: true, layer: 'L1', reason: "命令包含高危片段：'rm -rf /'", output: '', outputLength: 0 },
        ],
        status: BACKEND_STATUS,
      };
    case 'cancel':
      stopScript();
      return { cancelled: true, count: 1 };
    case 'rulesDiff':
      return {
        added: ['configs/permission_rules.local.yaml'],
        removed: [],
        changed: [],
        invalid: [],
        targetFile: 'configs/permission_rules.local.yaml',
      };
    case 'rulesSave':
      throw new Error('[−32601] 预览模式未实现写入：真实后端将在 Phase 4 提供 rulesSave');
    default:
      throw new Error(`[-32601] Method not found: ${method}（预览模式仅实现了部分方法）`);
  }
}

/* ---------------- 对外的 invoke 替身 ---------------- */
export async function previewInvoke(cmd: string, args?: Payload): Promise<unknown> {
  switch (cmd) {
    case 'backend_start':
      setTimeout(() => previewEmit('backend://status', BACKEND_STATUS), 40);
      return BACKEND_STATUS;
    case 'backend_stop':
      previewEmit('backend://exit', 0);
      return null;
    case 'backend_status':
      return { running: true, pid: 24581, python: '(浏览器预览模式)' };
    case 'rpc_send': {
      const payload = JSON.parse(String(args?.payload ?? '{}')) as {
        id?: number;
        method: string;
        params?: Payload;
      };
      // 异步返回，模拟真实往返
      setTimeout(() => {
        try {
          const result = dispatch(payload.method, payload.params ?? {});
          previewEmit(
            'rpc://message',
            JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const code = /-32601/.test(message) ? -32601 : -32603;
          previewEmit(
            'rpc://message',
            JSON.stringify({
              jsonrpc: '2.0',
              id: payload.id,
              error: { code, message: message.replace(/^\[[^\]]+\]\s*/, '') },
            }),
          );
        }
      }, 90);
      return null;
    }
    default:
      throw new Error(`预览模式未实现的命令：${cmd}`);
  }
}
