import type { IconId } from '../components/ui/IconSprite';

/**
 * 导航与路由模型。
 *
 * 分组与顺序逐值对齐设计稿侧栏（`design/console-ui.html` 的 `.side`）：
 * 监控 / 安全 / 基础设施 三组 + 底部固定的「设置」。
 */
export type ScreenId =
  | 'overview'    // 02 控制台总览
  | 'run'         // 03 执行时间线
  | 'report'      // 04 会话详情 / 诊断报告
  | 'permissions' // 05 权限分层
  | 'rules'       // 11 权限规则编辑器（权限分层的子页）
  | 'checker'     // 06 命令校验器
  | 'audit'       // 07 事件流审计
  | 'hosts'       // 08 目标主机
  | 'kernel'      // 09 内核 · 插件与能力
  | 'adapters'    // 10 模型适配器
  | 'settings';   // 设置（设计稿侧栏有此入口）

/** 非导航类的全屏状态：不渲染侧栏 */
export type ShellState = 'app' | 'boot' | 'disconnected';

export interface NavBadge {
  text: string;
  tone?: 'mut' | 'bad';
}

export interface NavItem {
  id: ScreenId;
  label: string;
  icon: IconId;
  badge?: NavBadge;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: '监控',
    items: [
      { id: 'overview', label: '控制台', icon: 'i-grid' },
      { id: 'run', label: '执行', icon: 'i-terminal' },
      { id: 'report', label: '会话记录', icon: 'i-database' },
    ],
  },
  {
    label: '安全',
    items: [
      { id: 'permissions', label: '权限分层', icon: 'i-shield' },
      { id: 'checker', label: '命令校验器', icon: 'i-terminal-2' },
      { id: 'audit', label: '事件审计', icon: 'i-list' },
    ],
  },
  {
    label: '基础设施',
    items: [
      { id: 'hosts', label: '目标主机', icon: 'i-server' },
      { id: 'kernel', label: '内核插件', icon: 'i-chip' },
      { id: 'adapters', label: '模型适配器', icon: 'i-plug' },
    ],
  },
];

/** 页头文案（`.ph` 的 h2 + sub）。副标题里的动态部分由页面自己覆盖。 */
export const SCREEN_META: Record<ScreenId, { title: string; sub: string }> = {
  overview: { title: '控制台', sub: '只读运维诊断总览' },
  run: { title: '执行时间线', sub: '实时事件流 · 权限拦截可见' },
  report: { title: '会话记录', sub: '单次诊断的完整留痕' },
  permissions: { title: '权限分层', sub: '3 层流水线 · 任一层拒绝即短路返回' },
  rules: { title: '权限规则', sub: 'configs/permission_rules.local.yaml' },
  checker: { title: '命令校验器', sub: '把命令直接喂给三层流水线，不连接任何主机' },
  audit: { title: '事件审计', sub: 'append-only JSONL · 可校验完整性、可回放' },
  hosts: { title: '目标主机', sub: '连接池按 (host, user) 复用 · 失败重试上限 3 次' },
  kernel: { title: '内核 · 插件与能力', sub: 'Kernel 只负责加载 / 卸载 / 依赖拓扑' },
  adapters: { title: '模型适配器', sub: '适配器即插件 · 切换会重建 Kernel' },
  settings: { title: '设置', sub: '运行参数与后端信息' },
};

/** 侧栏底部固定入口 */
export const NAV_FOOTER: NavItem = { id: 'settings', label: '设置', icon: 'i-sliders' };

/** 「会话记录」是列表页，点某条进详情 → 详情页复用 `report`，但高亮仍落在列表项上 */
export const NAV_ALIAS: Partial<Record<ScreenId, ScreenId>> = {
  rules: 'permissions',
};
