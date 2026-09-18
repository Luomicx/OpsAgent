# OpsAgent 桌面端 UI 重构计划

> 目标：把现有 Tauri 桌面端（`desktop/src/`）重构为 **1:1 复刻** `design/console-ui.html`
> 的 12 屏设计稿。
>
> 基准文件：`design/console-ui.html`（120 KB / 1796 行，12 屏）
> 现有前端：`desktop/src/`（13 文件 / 2,423 行，其中 CSS 827 行）

---

## 0. 先界定「1:1 复刻」到底指什么

这一节必须先讲清楚，否则会做出错误承诺。「1:1」在本项目里拆成三层，
**前两层严格 1:1，第三层必须分类处理**：

| 层面 | 是否 1:1 | 说明 |
| :--- | :--- | :--- |
| **视觉 1:1** | ✅ 严格 | 颜色、字体、字重、字号、圆角、阴影、边框透明度逐值对齐 |
| **几何 1:1** | ✅ 严格 | 窗口 1440×900、侧栏 222px、右栏 296px、内边距 18/24px、间距 14px 等逐值对齐 |
| **数据 1:1** | ⚠️ **分类** | 设计稿的数字（128 会话、3,412 事件、4,612 条规则…）是**示意值**。真实应用必须分类：能接真实数据的接，不能的显式占位 |

### 数据元素的三种处理方式（全文标记）

| 标记 | 含义 | 要求 |
| :--- | :--- | :--- |
| `[REAL]` | 现有 RPC 已支持 | 必须接真实数据，禁止写死 |
| `[DERIVE]` | 可由现有数据推导 | 前端计算得出，不得写死 |
| `[NEW]` | 需要新增后端能力 | 见第 7 节，需评估后再做 |
| `[PLACEHOLDER]` | 后端无此数据 | **必须视觉上标注为示例**，不得伪装成真实值 |

> ⚠️ **硬约束**：`[PLACEHOLDER]` 的数据在界面上必须有视觉区分（例如标签后缀
> 「示例」、或整块加 20% 降低不透明度）。这是 AGENTS.md 4.2「所有危险操作必须
> 写入审计日志」的同类精神 —— 不能让用户以为看到的是真实运行状态。

### 看板外壳不属于应用

`console-ui.html` 里有三类**只属于设计稿、不进应用**的元素，重构时必须丢弃：

| 元素 | 作用 | 处理 |
| :--- | :--- | :--- |
| `.bh` | 看板标题 + 色板说明 | ❌ 丢弃 |
| `.row` / `.board` | 每行 3 屏的画板网格 | ❌ 丢弃，应用一次只渲染 1 个 `.win` |
| `.cap-tag` | 画板下方编号说明 | ❌ 丢弃 |
| `.win` 外框 | 画板边框 + 圆角 + 阴影 | ⚠️ 由真实窗口取代（见第 8 节） |
| `.win:hover` 变换 | 看板浏览用的悬浮效果 | ❌ 丢弃（应用窗口不该浮起） |

---

## 1. 现状 vs 目标

### 1.1 现有前端的实际形态

| 维度 | 现状 |
| :--- | :--- |
| 布局 | `320px 配置侧栏` + `顶栏 52px` + `主区`，**无右侧栏** |
| 导航 | 3 个 Tab：执行时间线 / 权限分层 / 命令校验器 |
| 配置位置 | 主机、用户、适配器**都在侧栏常驻**（`Sidebar.tsx`） |
| 令牌 | 旧蓝黑系：`--bg-base:#0d1117`、`--accent:#4a9eff`、`--danger:#f0603f` |
| 字体 | Inter + JetBrains Mono（与设计稿一致 ✅） |
| 组件 | `TopBar` `Sidebar` `Timeline` `PermissionPanel` `CommandChecker` + `App.tsx` 编排 |

### 1.2 目标形态

| 维度 | 目标 |
| :--- | :--- |
| 布局 | `222px 导航侧栏` + `主区` + `按需 296px 右侧栏`（仅执行时间线有） |
| 导航 | **10 个导航项**，分 4 组（监控 / 安全 / 基础设施 / 设置） |
| 配置位置 | **迁出侧栏** → 主机归「目标主机」页，适配器归「模型适配器」页 |
| 令牌 | 深炭灰系：`--bg-1:#0A0B0D`、`--ac:#6D8FFF`、`--bad:#D9635A` |
| 屏数 | 3 个视图 → **12 个页面** |

### 1.3 信息架构迁移（关键改动）

这是本次重构**最容易被低估**的部分：现有侧栏承载的「主机/用户/适配器配置」
在设计稿里被拆走了，因此不是「换皮」而是**信息架构重排**。

```
现有                          目标
─────────────────────────────────────────────────────────
Sidebar.tsx
├─ 目标主机 input      ──迁到──▶  08 目标主机 页（主机卡片 + 连接池 + 认证）
├─ SSH 用户 input      ──迁到──▶  08 目标主机 页
├─ 模型适配器 select   ──迁到──▶  10 模型适配器 页（卡片式切换）
├─ 运行按钮 / 取消     ──保留──▶  03 执行时间线 底部输入条
└─ 插件/工具 chips     ──升级──▶  09 内核·插件与能力 页（表格 + 拓扑图）

TopBar.tsx             ──改造──▶  WindowChrome（标题栏，见第 8 节）
                                   后端状态迁到 chrome 右侧
Tabs（3 个）           ──扩展──▶  SideNav（10 项）
```

---

## 2. 设计令牌替换（逐值 1:1）

**做法**：把 `design/console-ui.html` 的 `:root` **逐字复制**为
`desktop/src/styles/tokens.css`，然后全局替换旧变量引用。**不要手工重写数值。**

### 2.1 新增令牌（直接复制）

```css
/* desktop/src/styles/tokens.css —— 来源：design/console-ui.html :root（逐字复制） */
:root{
  --bg-0:#060708; --bg-1:#0A0B0D; --bg-2:#0F1114;
  --bg-3:#14171B; --bg-4:#1A1E23; --bg-5:#22272E;

  --line:rgba(255,255,255,.06);
  --line-2:rgba(255,255,255,.10);
  --line-3:rgba(255,255,255,.16);

  --t1:#EDEFF2; --t2:#9BA1AC; --t3:#6B717C; --t4:#4A4F58;

  --ac:#6D8FFF; --ac-2:#8AA5FF;
  --ac-bg:rgba(109,143,255,.12); --ac-bd:rgba(109,143,255,.32);

  --ok:#45B98D;   --ok-bg:rgba(69,185,141,.12);
  --warn:#D8A43F; --warn-bg:rgba(216,164,63,.12);
  --bad:#D9635A;  --bad-bg:rgba(217,99,90,.12);
  --info:#5AA9D6; --info-bg:rgba(90,169,214,.12);
  --pur:#9B7ED9;  --pur-bg:rgba(155,126,217,.12);

  --r:10px; --r-sm:7px; --r-lg:14px;
  --mono:'JetBrains Mono','Cascadia Code',Consolas,monospace;
  --sans:'Inter','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;
  --sh:0 1px 2px rgba(0,0,0,.5);
  --sh-2:0 24px 60px -30px rgba(0,0,0,.95);
}
```

### 2.2 旧变量 → 新变量 映射表

| 旧变量 | 旧值 | 新变量 | 新值 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| `--bg-base` | `#0d1117` | `--bg-1` | `#0A0B0D` | 应用底色 |
| `--bg-panel` | `#141a22` | `--bg-2` | `#0F1114` | 面板（侧栏/右栏） |
| `--bg-panel-2` | `#1a212b` | `--bg-3` | `#14171B` | 卡片/输入 |
| `--bg-input` | `#0f151c` | `--bg-0` | `#060708` | 代码块用最深底 |
| `--border` | `#232c38` | `--line` | `rgba(255,255,255,.06)` | ⚠️ 实色 → 半透明 |
| `--border-strong` | `#2f3b4a` | `--line-2` | `rgba(255,255,255,.10)` | |
| `--text` | `#e6edf3` | `--t1` | `#EDEFF2` | |
| `--text-dim` | `#9aa7b6` | `--t2` | `#9BA1AC` | |
| `--text-faint` | `#6b7887` | `--t3` | `#6B717C` | |
| — | — | `--t4` | `#4A4F58` | 新增：极弱文字/表头 |
| `--accent` | `#4a9eff` | `--ac` | `#6D8FFF` | 强调色更收敛 |
| `--accent-dim` | `#1f4f86` | `--ac-bd` | `rgba(109,143,255,.32)` | |
| `--ok` | `#2fbf8f` | `--ok` | `#45B98D` | 去饱和 |
| `--warn` | `#e8b23a` | `--warn` | `#D8A43F` | 去饱和 |
| `--danger` | `#f0603f` | `--bad` | `#D9635A` | 更暗、不刺眼 |
| `--layer-l1` | `#f0603f` | `--bad` | `#D9635A` | 合并 |
| `--layer-l2` | `#e8b23a` | `--warn` | `#D8A43F` | 合并 |
| `--layer-l3` | `#a97bf0` | `--pur` | `#9B7ED9` | 去饱和 |
| `--radius` | `8px` | `--r` | `10px` | |
| `--radius-sm` | `5px` | `--r-sm` | `7px` | |

> **迁移提示**：`--border` 从实色变半透明，意味着所有 `border: 1px solid var(--border)`
> 会变成「几乎看不见的描边」——这是设计稿刻意的「靠明度分层，不靠描边」。
> 改造时要**同时**把依赖描边建立层级的元素改成靠 `background` 明度差分层。

---

## 3. 精确尺寸规格表（几何 1:1 的基准值）

实现时**逐值对照此表**，不要凭手感调。

### 3.1 外壳

| 部件 | 值 | 来源类 |
| :--- | :--- | :--- |
| 窗口 | `1440 × 900` | `.win` |
| 窗口圆角 | `12px` | `.win` |
| 标题栏高度 | `42px`（`flex:0 0 42px`） | `.chrome` |
| 标题栏内边距 | `0 16px`，`gap:12px` | `.chrome` |
| 导航侧栏宽 | `222px`（`flex:0 0 222px`） | `.side` |
| 侧栏内边距 | `12px 10px` | `.side` |
| 右栏宽 | `296px`（`flex:0 0 296px`） | `.rail` |
| 页头内边距 | `18px 24px 14px`，`gap:14px` | `.ph` |
| 内容区 | `padding:0 24px 20px`，`gap:14px` | `.bd` |

### 3.2 组件

| 组件 | 值 |
| :--- | :--- |
| 卡片 | `radius:10px`，`border:1px solid var(--line)` |
| 卡片内边距 | `.pad` = `16px`；`.hd` = `13px 16px` |
| 按钮 | `height:32px`，`padding:0 13px`，`radius:7px`，`font-size:12px` |
| 小按钮 | `height:26px`，`padding:0 10px`，`font-size:11px` |
| 图标按钮 | `30×30px`，`radius:7px` |
| 标签 `.tag` | `padding:2px 8px`，`radius:5px`，`font-size:10.5px`，`font-weight:600` |
| 胶囊 `.chip` | `padding:5px 11px`，`radius:100px`，`font-size:11.5px` |
| 表格 `th` | `padding:9px 12px`，`font-size:9.5px`，`letter-spacing:.13em`，大写 |
| 表格 `td` | `padding:9px 12px`，`font-size:12px` |
| 紧凑表 `.tc` | `padding:7px 12px`，`font-size:11.5px` |
| KPI 卡 | `padding:15px 16px`，数值 `27px/600/-.035em` |
| 输入 `.inp` | `height:34px`，`padding:0 12px`，`radius:7px`，`bg:--bg-3` |
| 提示条 `.bnr` | `padding:10px 13px`，`radius:7px`，`font-size:11.5px` |
| 进度条 `.bar` | `height:5px`，`radius:5px`，轨道 `rgba(255,255,255,.07)` |

### 3.3 排版尺度

| 用途 | 字号 / 字重 |
| :--- | :--- |
| 页标题 `h2` | `19px / 600 / letter-spacing:-.02em` |
| 页副标题 `.sub` | `11.5px / 400`，色 `--t3` |
| 卡片标题 `h3` | `12.5px / 600` |
| 分组标签 `.lbl` | `9.5px / 600 / letter-spacing:.15em`，大写，色 `--t4` |
| 正文 | `13px`（body） |
| 命令 / 日志 | `11.5px`，`--mono` |
| 侧栏导航 `.ni` | `12.5px / 500`，内边距 `8px 10px` |

### 3.4 动画（保留，但去掉看板专用项）

| 动画 | 用途 | 保留 |
| :--- | :--- | :--- |
| `@keyframes dr`（`stroke-dasharray` 描边） | 折线图入场 | ✅ 保留 |
| `@keyframes pp`（数据点弹入） | 折线图数据点 | ✅ 保留 |
| `@keyframes fi`（面积淡入） | 折线图面积 | ✅ 保留 |
| `@keyframes br`（呼吸） | 运行中状态点 | ✅ 保留 |
| `@keyframes gw`（进度条生长） | 进度条 / 横向条 | ✅ 保留 |
| `@keyframes sc`（扫描线） | 启动页 | ✅ 保留 |
| `@keyframes bmk`（logo 浮动） | 启动页 | ✅ 保留 |
| `.win:hover` 上浮 | **看板浏览用** | ❌ 删除 |
| `.card.hv:hover` 上浮 + `filter` | 卡片悬浮 | ✅ 保留（设计要求） |

---

## 4. 目标文件结构

```
desktop/src/
├── styles/
│   ├── tokens.css               ← 第 2.1 节，逐字复制
│   ├── base.css                 ← 重置 / 字体 / 滚动条
│   ├── components.css           ← 第 5 节通用组件
│   └── screens/
│       ├── overview.css         ├── timeline.css
│       ├── report.css           ├── permission.css
│       ├── checker.css          ├── audit.css
│       ├── hosts.css            ├── kernel.css
│       ├── adapters.css         ├── rules.css
│       └── boot.css             (含 disconnected)
├── components/
│   ├── chrome/
│   │   └── WindowChrome.tsx     ← 标题栏（见第 8 节）
│   ├── layout/
│   │   ├── AppShell.tsx         ← side + main + rail 三栏骨架
│   │   ├── SideNav.tsx          ← 10 项导航
│   │   ├── PageHeader.tsx       ← .ph
│   │   └── Rail.tsx             ← 296px 右栏容器
│   ├── ui/                      ← 设计稿通用组件（第 5 节）
│   │   ├── Card.tsx  Btn.tsx  Tag.tsx  Chip.tsx
│   │   ├── Bar.tsx   Kpi.tsx  Tbl.tsx  Bnr.tsx  Inp.tsx
│   │   └── Icon.tsx             ← <symbol> 图标
│   └── screens/                 ← 第 6 节，12 个页面组件
│       ├── BootScreen.tsx       ├── OverviewScreen.tsx
│       ├── TimelineScreen.tsx   ├── ReportScreen.tsx
│       ├── PermissionScreen.tsx ├── CheckerScreen.tsx
│       ├── AuditScreen.tsx      ├── HostsScreen.tsx
│       ├── KernelScreen.tsx     ├── AdaptersScreen.tsx
│       ├── RulesScreen.tsx      └── DisconnectedScreen.tsx
├── lib/
│   ├── nav.ts                   ← 导航模型（10 项 + 分组）
│   ├── types.ts                 ← 扩展（第 7 节）
│   ├── api.ts                   ← 扩展（第 7 节）
│   ├── rpc.ts                   ← 基本不动
│   └── timeline.ts              ← 不动，被 TimelineScreen 复用
├── App.tsx                      ← 只保留：连接状态 + 路由 + 全局状态
└── main.tsx
```

**删除**：`components/Sidebar.tsx`、`components/TopBar.tsx`（能力已迁移）
**保留复用**：`lib/rpc.ts`、`lib/timeline.ts`（零改动）

---

## 5. 通用组件规格（从设计稿提取）

按设计稿的类逐个提取，实现时**直接用设计稿的 CSS 值**，不要重新发明。

| 组件 | 设计稿类 | 关键规格 |
| :--- | :--- | :--- |
| `Card` | `.card` / `.pad` / `.hd` | `bg:--bg-2`，`border:1px solid --line`，`radius:10px`，`overflow:hidden` |
| `Card.hover` | `.hv` | hover 时 `translateY(-2px)` + `filter:drop-shadow(0 14px 28px rgba(0,0,0,.6))` |
| `Btn` | `.btn` / `.pri` / `.gh` / `.dg` / `.sm` | 见 3.2；`.pri` 用 `--ac` 底 + `#050A18` 字 |
| `Tag` | `.tag` + 6 种色 | `ok/bad/warn/info/ac/pur/mut`，见 2.1 的 `*-bg` |
| `Chip` | `.chip` / `.chip.on` | `on` 态：`bg:--ac-bg`，`border:--ac-bd`，`color:--ac-2` |
| `Bar` | `.bar` + `i` | `i` 宽度用内联 style，语义色靠 `.ok/.bad/.warn` |
| `Kpi` | `.kpi` | 数值必须 `font-variant-numeric:tabular-nums` |
| `Tbl` | `.tbl` / `.tc` | `border-collapse:collapse`，`tr:hover` 提亮 |
| `Bnr` | `.bnr` + `bad/warn/info/ok` | 带图标，`11.5px` |
| `Dot` | `.dot` + `ok/bad/warn/mut` | `6×6px` 圆点，`ok/bad/warn` 带 glow |
| `Ring` | `.ring` / `.vl` / `.vl86` | `pathLength=100` + `stroke-dasharray` 动画；`.vl86` 画到 86% 停 |
| `Topo` | `.topo` | 绝对定位节点 + SVG 连线；节点坐标见设计稿 09 屏 |

> ⚠️ **必须避开的坑**：设计稿里画板说明文字用的类名是 `.cap-tag`（**不是** `.cap .tag`）。
> 重构时**不要**把任何说明文字写成「容器 + 通用类」的形式 —— 那会让通用类的作用域
> 泄漏到整棵子树。见第 11 节风险记录。

---

## 6. 十二屏逐屏复刻规格

统一骨架（除 01 / 12）：`WindowChrome(42)` + `SideNav(222)` + `Main` + 可选 `Rail(296)`。
主区 = `PageHeader(18/24/14)` + `bd(padding 0 24 20, gap 14)`。

---

### 01 启动 / 后端握手 `BootScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | **无侧栏无标题栏区隔** —— 整个窗口是 `.boot` 面板 |
| 布局 | 居中：logo orb(78×78/radius20) → 标题(31px) → 副标题 → 步骤列表(520px 宽) → 扫描线 |
| 组件 | `.boot` `.grid`（44px 网格 + 径向 mask）`.steps/.stp`（5 步）`.scan` |
| 数据 | 5 个启动步骤：`[REAL]` 部分（RPC 握手）+ `[PLACEHOLDER]` 耗时数字 |
| 缺口 | 需 Rust 侧上报「尝试过的启动方式」与各阶段耗时 → 见 7.3 |

### 02 控制台总览 `OverviewScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main（**无右栏**） |
| 主区结构 | 4×KPI → `1fr + 292px`（折线图卡 + 通过率环卡）→ `1fr 1fr`（工具分布 + 最近会话） |
| 组件 | `.kpis` `.kpi` 折线图（`.chart`，3 条 `.ln`）`.ring` `.hb`（横向条）`.tbl` |
| 数据 | 会话总数 `[NEW]`、事件总数 `[REAL: status.eventCount]`、权限拦截 `[DERIVE]`、覆盖率 `[PLACEHOLDER]`、7 天趋势 `[NEW]`、工具分布 `[DERIVE: 事件流聚合]`、最近会话 `[NEW]` |

### 03 执行时间线 `TimelineScreen`（核心屏）

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main + **Rail(296)** |
| 主区 | PageHeader（含"取消"按钮）→ `.tl` 时间线（10 个 `.ev`）→ `.composer` 底部输入条 |
| 事件类型 | 指令 / 推理 / 工具调用 / 权限通过 / **拦截（红底展开代码块）** / 结论 |
| 右栏 | 会话信息(4 格) + 进度条 + 快捷指令(4) + 事件流(7 行) + 会话操作(3 按钮) |
| 组件 | `.tl` `.ev`（`bad/good/fin` 三态）`.code` `.composer` |
| 数据 | 时间线 `[REAL: 由 lib/timeline.ts 归约]`；会话统计 `[DERIVE]`；快捷指令 `[PLACEHOLDER]` |
| 复用 | **`lib/timeline.ts` 零改动**，现有 `toTimelineEntry` 直接产出 `.ev` 所需字段 |

> 改动要点：现有 `Timeline.tsx` 的视觉（`.entry` 系列）整体替换为设计稿的 `.ev` 系列，
> 但**归约逻辑不动** —— 这是本次重构里最省力的一屏。

### 04 会话详情 / 诊断报告 `ReportScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main |
| 主区 | 结论卡（13.5px/1.85）→ 4×KPI → 步骤留痕表（4 列）+ 底部拦截提示条 |
| 组件 | `.card` `.kpi` `.tbl`（含 `background:rgba(217,99,90,.055)` 的拦截行）`.bnr.bad` |
| 数据 | 结论 `[REAL: AgentResult.text]`、步数 `[REAL: stepsUsed]`、工具调用 `[DERIVE: steps.length]`、拦截 `[REAL: deniedCount]`、耗时 `[NEW]`（AgentResult 无耗时字段） |

### 05 权限分层 `PermissionScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main |
| 主区 | 顶部 info 提示条 → 3×层卡片（L1/L2/L3）→ L1 规则明细表（13 行，含命中热度条） |
| 组件 | `.lay`（层卡）`.tbl.rl-tbl`（`.pat` 代码化模式串）`.bar` `.tag` |
| 数据 | 全部 `[REAL: permission RPC]` —— 层名/规则数/规则模式/描述均已有 |
| 缺口 | 规则**命中次数** `[NEW]`（需事件流聚合）→ 无则显示 `—` |

> 关键：设计稿顶部提示条明确写了 **L5 路径管控缺失**。这是真实已知限制
> （见 `docs/INTERVIEW.md` 第五节），**必须原样保留**，不得为了好看删掉。

### 06 命令校验器 `CheckerScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main |
| 主区 | 命令输入卡（`$` + mono + 校验按钮）→ 判定结果卡（拒绝态）→ **流水线执行路径**（3 段 `.pipe`）→ 对比样本 chips → 校验历史表 |
| 组件 | `.pipe`（`.st.pass/.stop`）`.chip` 带语义圆点 `.tbl.tc` |
| 数据 | 判定 `[REAL: checkCommand]`；短路路径 `[DERIVE: decision.layer]`；样本 `[PLACEHOLDER]`（静态列表）；历史 `[DERIVE: 前端本地记录]` |
| 亮点 | 流水线路径是本屏核心 —— 用 `decision.layer` 决定哪一段 `.stop`、后续段降为 38% 不透明度 |

### 07 事件流审计 `AuditScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main |
| 主区 | 4×KPI → 事件表（12 行，`SEQ/时间/类型/data`）+ 底部回放控制条 |
| 组件 | `.tbl.tc`（事件类型用彩色 `.tag`）`.bar`（回放进度）`.btn` |
| 数据 | 全部 `[REAL: replay RPC]` —— 事件数组 + 完整性校验已有；**表头事件计数** `[DERIVE]` |
| 缺口 | 回放**播放控制**需前端实现（逐条推进 + 速率），后端无需改动 |

### 08 目标主机 `HostsScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main |
| 主区 | dry-run 提示条（警告色）→ 3×主机卡 → `1fr 1fr`（连接池状态 + 认证方式表） |
| 组件 | `.bnr.warn` 主机卡（图标 + 主机名 + 状态 tag + 4 格键值）`.hb` `.tbl.tc` |
| 数据 | **几乎全是 `[NEW]`** —— 现有 `status` 不含 hosts 列表。见 7.2 |

### 09 内核 · 插件与能力 `KernelScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main |
| 主区 | `376px + 1fr`（插件表 9 行 + **依赖拓扑图**）→ 能力注册表卡 |
| 组件 | `.tbl.tc` `.topo`（9 个绝对定位节点 + 12 条 SVG 路径）`.tag.mut` chips |
| 数据 | 插件列表 `[REAL: status.plugins]`、能力注册表 `[REAL: status.capabilities]`、版本 `[PLACEHOLDER]` |
| 缺口 | **拓扑连线关系** `[NEW]` —— `status` 只有名字，无 `requires` 依赖图。见 7.2 |

### 10 模型适配器 `AdaptersScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main |
| 主区 | `1fr 1fr`（mock 卡 + deepseek 卡）→ 运行参数 4 格 → 适配器契约卡 |
| 组件 | 适配器卡（`.hd` 带图标 + 状态 tag）`.fld`（label + `.inp`）`.code` |
| 数据 | 当前适配器 `[REAL: status.adapter]`、Key 是否存在 `[REAL: status.apiKeyPresent]` |
| 缺口 | 运行参数（temperature / max_steps / keep_recent / max_tool_output_chars）`[NEW]` |

### 11 权限规则编辑器 `RulesScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side + Main |
| 主区 | 警告提示条 → `1fr + 330px`（L2 规则表 + 编辑面板） |
| 组件 | `.tbl.rl-tbl`（9 行，可编辑）编辑面板（无边框 `.inp` + `.tag` 可删项）`.bnr` |
| 数据 | 规则读取 `[REAL]`；**写入 `[NEW]` 且触及安全边界** |
| ⚠️ | 见 7.4 —— 这是本计划**唯一需要你决策**的功能性改动 |

### 12 空状态 / 后端断开 `DisconnectedScreen`

| 项 | 内容 |
| :--- | :--- |
| 骨架 | Side（**40% 不透明度全禁用**）+ Main |
| 主区 | 居中空状态（图标 + 标题 + 说明 + 2 按钮）→ 底部三栏诊断信息 |
| 组件 | `.empty` `.or` `.btn` 三栏 `.pad` + `.lbl` + `.mono` |
| 数据 | 退出码 `[REAL: backend://exit]`、stderr `[REAL: backend://error]`、**尝试过的启动方式** `[NEW: Rust 侧]`、修复建议 `[DERIVE 静态映射]` |

---

## 7. 数据与 RPC 缺口清单

**原则**：先做 `[REAL]` / `[DERIVE]`，`[NEW]` 分批评估，`[PLACEHOLDER]` 显式标注。

### 7.1 无需后端改动（覆盖约 60% 的界面）

| 设计元素 | 数据源 |
| :--- | :--- |
| 事件总数 | `status.eventCount` |
| 事件流时间线 | 事件推送 + `lib/timeline.ts` |
| 会话结论 / 步数 / 拦截数 | `AgentResult`（`text` / `stepsUsed` / `deniedCount` / `steps[]`） |
| 权限三层 + 规则明细 | `permission` RPC |
| 命令判定 + 命中层 | `checkCommand` RPC |
| 事件审计 + 完整性 | `replay` RPC |
| 插件列表 / 能力注册表 | `status.plugins` / `status.capabilities` |
| 适配器 / Key 是否存在 | `status.adapter` / `status.apiKeyPresent` |
| 后端断开 / 错误 | `backend://exit` / `backend://error` 事件 |

### 7.2 建议新增的 RPC（按性价比排序）

| 优先级 | 方法 | 返回 | 服务的屏 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **P0** | `stats` | 会话数 / 事件数 / 拦截数 / 工具分布 / 7 天趋势 | 02 | 纯聚合，读 `EventStore` 即可，不改核心 |
| **P0** | `hosts` | 主机列表（host/user/port/状态/池占用/认证来源） | 08 | 读 `ssh_pool` 配置，只读 |
| **P1** | `sessions` | 会话索引（id/主机/步骤/拦截/状态/时间） | 02 / 04 | 需扫描 `.sessions/*.jsonl` |
| **P1** | `kernelTopology` | 插件 `requires` 边列表 | 09 | 从 `Plugin.requires` 直接导出 |
| **P2** | `config` | 运行参数快照（只读） | 10 | 读 `kernel.config` |
| **P2** | `runMeta` | 单次 run 的耗时 | 04 | `AgentResult` 加 `elapsed_ms` |

> 这些全部是**只读**新增，不动 Kernel、不动权限层 → 符合 AGENTS.md 2.1「新增能力 = 新增插件」
> 的约束（桥接层只是 `build_kernel()` 的又一个消费者）。

### 7.3 Rust 侧需补充

| 项 | 目的 | 改动 |
| :--- | :--- | :--- |
| 启动候选列表 | 12 屏诊断信息显示「尝试过的启动方式」 | `SidecarManager::candidates()` 结果经 `backend_status` 上报 |
| 各阶段耗时 | 01 屏步骤右侧的 ms | 在 `start()` 里记录时间戳 |
| 退出码 | 12 屏诊断 | 已部分支持（`backend://exit`） |

### 7.4 规则编辑器写入 —— ✅ 已决策：**选项 B（可写）**

设计稿 11 屏带「保存并重载」按钮，意味着**前端能写权限规则**。原有三个问题：
修改权限规则 = 修改安全策略本身；AGENTS.md 明文「不要修改
`configs/permission_rules.yaml` 的默认规则」；后端无写接口。

**已确定采用选项 B**，但必须满足以下**四条安全约束**（缺一不可）：

| # | 约束 | 理由 |
| :--- | :--- | :--- |
| 1 | **只写 `configs/permission_rules.local.yaml`**，永不触碰默认规则文件 | 遵守 AGENTS.md；默认规则保持可复现，本地覆盖可随时删除恢复 |
| 2 | **写入前必须二次确认**，弹窗需列出「本次将新增/修改/删除的具体规则」原文 | 改安全策略属于高危操作，AGENTS.md 4.2 要求显式确认 |
| 3 | **写入必须落审计事件**（时间戳、操作人、变更前后 diff） | AGENTS.md 4.2「高危操作必须写入审计日志」 |
| 4 | **保存后需显式重载并回报结果**（成功/失败/哪条规则非法） | 避免「看着保存成功、实际没生效」 |

**新增 RPC**（归入 Phase 4，与其它 P0/P1 一起做）：

| 方法 | 入参 | 返回 | 备注 |
| :--- | :--- | :--- | :--- |
| `rulesDiff` | 拟变更的规则集 | 变更预览（新增/修改/删除 + 校验结果） | 供二次确认弹窗展示 |
| `rulesSave` | 确认后的规则集 | 新规则集快照 + 新事件 seq | 写 `.local.yaml` + 写审计事件 + 重载流水线 |

**Phase 3 期间的处理**：11 屏按可写形态做出完整交互（编辑、确认弹窗、
保存按钮），后端接口未就绪时按钮走「未连接」分支并明确提示，
**不得静默假装保存成功**。

---

## 8. Tauri 窗口与标题栏

设计稿的 `.win` 含 `42px` 自绘标题栏（红黄绿点 + 标题 + 右侧状态）。
真实 Tauri 窗口默认由系统绘制标题栏，会多出一条，导致**几何对不上 1:1**。

| 方案 | 做法 | 评价 |
| :--- | :--- | :--- |
| **A ✅ 已决策** | `tauri.conf.json` 设 `"decorations": false`，自绘标题栏复刻 `.chrome` | 几何完全 1:1；需自己实现拖拽/最小化/关闭 |
| B | 保留系统装饰，删除 `.chrome` 那一行 | 少写代码，但 900px 高度里少 42px，内容区要重排 |

**采用方案 A**。自绘标题栏需一并实现：

| 项 | 实现 |
| :--- | :--- |
| 拖拽 | `getCurrentWindow().startDragging()` |
| 最小化 / 最大化 / 关闭 | `getCurrentWindow().minimize() / toggleMaximize() / close()` |
| capabilities | `desktop/src-tauri/capabilities/default.json` 补 `core:window:allow-start-dragging`、`allow-minimize`、`allow-toggle-maximize`、`allow-close` |
| 红黄绿点 | **只做视觉**，不接窗口控制（macOS 风格按钮在 Windows 上易误触）；窗口控制放到右侧。若要求严格复刻，则三点接最小化/最大化/关闭 |

**窗口尺寸同步调整**：

```jsonc
// desktop/src-tauri/tauri.conf.json
"windows": [{
  "title": "OpsAgent · 只读运维诊断",
  "width": 1440,        // 1360 → 1440
  "height": 900,        // 880 → 900
  "minWidth": 1180,     // 1080 → 1180（222+296+主区最小宽度）
  "minHeight": 720,     // 680 → 720
  "decorations": false  // 方案 A 新增
}]
```

> 方案 A 下需在 `capabilities/default.json` 补 `core:window:allow-start-dragging`
> 等权限，并在 Rust 侧加最小化/关闭命令。

---

## 9. 分阶段执行计划

每阶段**独立可验收**，且**随时可停**（不会留下半成品状态）。

### Phase 0 · 令牌与样式地基（不改结构）

1. 新建 `styles/tokens.css`（第 2.1 节逐字复制）
2. `styles/base.css`：重置 + 字体（Inter / JetBrains Mono / Noto Sans SC）+ 隐藏滚动条
3. 旧 `global.css` 按第 2.2 节做变量替换（先用映射把旧变量指向新值，**不改类名**）
4. 加 `styles/components.css`（第 5 节通用组件）

**验收**：应用能跑，**观感立刻变成深炭灰**，无功能回归。
此阶段结束就已经拿到 70% 的视觉收益。

### Phase 1 · 外壳重构

5. `components/chrome/WindowChrome.tsx` + Tauri `decorations:false`
6. `components/layout/AppShell.tsx`（side + main + rail 三栏）
7. `components/layout/SideNav.tsx`（10 项 + 4 分组）
8. `lib/nav.ts` 路由模型
9. 删除 `Sidebar.tsx` / `TopBar.tsx`

**验收**：窗口 1440×900，侧栏 222px，导航可点击切换（先全部渲染占位内容）。

### Phase 2 · 复用现有三屏（低风险高收益）

10. `TimelineScreen`（复用 `lib/timeline.ts`，视觉换成 `.ev`）
11. `PermissionScreen`（复用 `permission` RPC）
12. `CheckerScreen`（复用 `checkCommand` RPC）

**验收**：三屏与设计稿逐像素对齐；**功能与改造前完全一致**。

### Phase 3 · 纯展示屏

13. `BootScreen`（含扫描线 + 步骤列表）
14. `DisconnectedScreen`（含三栏诊断）
15. `OverviewScreen`（先用 `[PLACEHOLDER]` 填充，标注示例）
16. `ReportScreen`
17. `AuditScreen`（含回放控制条）
18. `KernelScreen`（含拓扑图）
19. `AdaptersScreen`
20. `RulesScreen`（**按 7.4 选项 A：只读**）

**验收**：12 屏全部可达，无空白页。

### Phase 4 · 后端补数据（P0/P1）

21. `stats` RPC → 替换 02 屏占位
22. `hosts` RPC → 替换 08 屏占位
23. `kernelTopology` RPC → 替换 09 屏拓扑（去掉硬编码连线）
24. `sessions` RPC → 替换 02/04 屏占位
25. 配套 `tests/bridge/` 测试

**验收**：占位标记逐项消失；`pytest` 全绿。

### Phase 5 · 像素级校对

26. 用第 10 节方法做设计稿 vs 实际应用的**几何比对**
27. 修偏差直到关键尺寸全部对齐

**验收**：见第 10 节判据。

### Phase 6 · 收尾

28. `README.md` / `desktop/README.md` 同步新界面
29. `docs/INTERVIEW.md` 的 UI 截图更新
30. `cargo check` + `npm run typecheck` + `vite build` + `pytest`

---

## 10. 验收与像素比对方法

复用已验证的方法（`~/.workbuddy/skills/html-layout-verify/SKILL.md`）：
**不靠肉眼，用 headless Chrome 注入探针测真实几何。**

### 10.1 关键尺寸断言

在应用里注入探针，断言以下值与设计稿一致（误差 ≤ 1px）：

```js
const A = [
  ['.chrome', 'height', 42],  ['.side', 'width', 222], ['.rail', 'width', 296],
  ['.ph', 'padding', '18px 24px 14px'], ['.bd', 'padding', '0px 24px 20px'],
  ['.bd', 'gap', '14px'], ['.card', 'borderRadius', '10px'],
  ['.btn', 'height', '32px'], ['.tag', 'fontSize', '10.5px'],
];
```

### 10.2 布局健康度（两个指标一起测）

对每个屏的主容器测：

- **溢出** `scrollHeight - clientHeight` → 必须 `<= 0`
- **底部空白** `容器底 - 最后子元素底` → 必须 `<= 40px`

> 只测溢出不够：把 flex 子元素从「被压扁」修成正常高度后，
> 表格会突然变矮，原本靠压缩勉强铺满的版面会露出大片空白。

### 10.3 逐屏比对流程

1. 设计稿渲染：`design/console-ui.html` 用 `.row:nth-of-type(N){display:flex}` 只保留目标行
2. 应用渲染：导航到同一屏，窗口设为 1440×900
3. 两者各截图，逐屏比对
4. 设计稿基线（已测得，全部通过）：

```
02总览 over=0 空白=20   03时间线 over=0 空白=20   03右栏 over=0 空白=7
04报告 over=0 空白=20   05权限   over=0 空白=20   06校验器 over=0 空白=20
07审计 over=0 空白=20   08主机   over=0 空白=20   09内核  over=0 空白=20
10适配器 over=0 空白=20  11规则   over=0 空白=20  12空状态 over=0 空白=24
```

### 10.4 静态自检（每次改动后跑）

```python
# 图标引用必须全部可解析（漏掉的会静默渲染成空白）
syms = set(re.findall(r'<symbol id="([^"]+)"', html))
uses = re.findall(r'<use href="#([^"]+)"', html)
assert not {u for u in uses if u not in syms}
```

---

## 11. 风险与注意事项

| 风险 | 说明 | 应对 |
| :--- | :--- | :--- |
| **⚠️ 后代选择器作用域泄漏** | 设计稿曾用 `.cap .tag` 写画板说明文字，导致**画板内所有状态标签被劫持**（`display:flex` + `margin-top:16px`），表格行高从 36px 变 70px，症状极像表格 bug | 重构时**禁止**用「容器 + 通用类」写局部样式；一律用独立类名（如 `.cap-tag`）。已写入 skill |
| **半透明边框导致层级失效** | `--border` 从实色变 `rgba(255,255,255,.06)`，旧代码里靠描边分层的元素会「失去边界」 | Phase 0 同步把这类元素改为靠 `background` 明度差分层 |
| **信息架构迁移风险** | 侧栏配置项拆到两个页面，用户习惯改变 | 在 03 屏输入条旁保留「切换主机」快捷入口作为过渡 |
| **占位数据被误认为真实** | 02/08/09 等屏有示意数字 | 强制视觉标注（后缀「示例」+ 降不透明度），Phase 4 逐项清除 |
| **自绘标题栏** | 需自己实现拖拽/最小化/关闭，且要在 capabilities 里放权限 | 若时间紧，先走 8 节方案 B，后续再切 A |
| **字体未加载** | Inter / JetBrains Mono 走 Google Fonts，离线时回落到系统字体，字宽变化会破坏 1:1 | 离线场景需**本地打包字体**（`@font-face` + `woff2`） |
| **规则编辑器边界** | 见 7.4 | 默认只读；要写入须先确认 |

---

## 12. 工作量拆分（相对量级）

| 阶段 | 内容 | 量级 |
| :--- | :--- | :--- |
| Phase 0 | 令牌 + 通用组件 | 中 |
| Phase 1 | 外壳 + 导航 + 标题栏 | 中 |
| Phase 2 | 复用三屏 | 小（归约逻辑不动） |
| Phase 3 | 9 个新屏 | **大**（工作量大头） |
| Phase 4 | 5 个新 RPC + 测试 | 中 |
| Phase 5 | 像素校对 | 中 |
| Phase 6 | 文档收尾 | 小 |

**建议**：Phase 0–2 一次性完成（拿到 70% 视觉收益且零功能风险），
Phase 3 按屏逐个提交（每屏一个 commit，便于回退），Phase 4 独立成批。

---

## 附：已确认的三项决策

| # | 问题 | 决策 | 影响 |
| :--- | :--- | :--- | :--- |
| 1 | 规则编辑器 | **B —— 可写**（写 `.local.yaml` + 二次确认 + 审计事件 + 保存后重载回报） | Phase 3 做完整交互；Phase 4 增加 `rulesDiff` / `rulesSave` 两个 RPC |
| 2 | 标题栏 | **A —— 自绘**（`decorations:false`） | 几何完全 1:1；需补 capabilities 权限与窗口控制 |
| 3 | 新 RPC 节奏 | **先全部落地新前端**，再补数据 | Phase 0–3 一口气做完 12 屏；Phase 4 统一补 7 个 RPC |

### 执行顺序（本次开工）

```
① 提交并推送现状（design/ + docs/）
② Phase 0  令牌与样式地基
③ Phase 1  外壳重构（自绘标题栏 + 三栏骨架 + 10 项导航）
④ Phase 2  复用现有三屏（时间线 / 权限 / 校验器）
⑤ Phase 3  新增 9 屏（含规则编辑器可写形态）
⑥ Phase 4  补 7 个 RPC：stats / hosts / sessions / kernelTopology
           / config / runMeta / rulesDiff + rulesSave
⑦ Phase 5  像素级校对
⑧ Phase 6  文档收尾
```

> Phase 3 结束时 12 屏全部可达；未接后端的区域一律走 `[PLACEHOLDER]` 分支
> 并**在界面上标注为示例**，Phase 4 逐项替换为真实数据。
