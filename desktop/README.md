# OpsAgent Desktop

OpsAgent 的桌面客户端 —— **Tauri + React**，把 Python 核心的「只读运维诊断」能力
包成一个可视化应用。核心价值是让**权限拦截过程可见**：每一次工具调用、每一次拒绝、
每一步推理，都实时呈现在时间线上，而不是埋在日志里。

## 为什么用 Tauri 而不是纯 Web

| 关注点 | 选择 Tauri 的理由 |
| :--- | :--- |
| 分发 | 产物是原生可执行文件（Windows 上是 WebView2 + MSI/NSIS），不需要用户装 Python 环境 |
| 安全 | 前后端走 **stdio 管道**，不开监听端口 —— 没有防火墙弹窗，也没有「本地端口被别的进程连上」的风险 |
| 体积 | 复用系统 WebView2，不打包整个 Chromium；release 构建开启 `lto` + `opt-level="s"` + `strip` |

## 架构

```text
┌──────────────────────── WebView (React + TS) ────────────────────────┐
│  App.tsx                                                             │
│    ├─ TopBar            连接状态 / 适配器 / 事件数                    │
│    ├─ Sidebar           主机、用户、适配器、插件与工具清单            │
│    ├─ Timeline          实时事件流（执行时间线）                      │
│    ├─ PermissionPanel   三层规则浏览                                  │
│    └─ CommandChecker    命令权限校验器（不连主机）                    │
│                                                                       │
│  lib/rpc.ts     请求/响应配对、事件分流、超时兜底                     │
│  lib/api.ts     业务方法封装（run / checkCommand / permission …）     │
│  lib/timeline.ts 事件 → 时间线（纯函数，可单测）                      │
└───────────────────────────────┬───────────────────────────────────────┘
                                │  Tauri IPC（invoke / emit）
┌───────────────────────────────▼───────────────────────────────────────┐
│  src-tauri (Rust)                                                     │
│    sidecar.rs   spawn Python、按行收发、进程生命周期                  │
│    lib.rs       命令注册 + 事件泵（sidecar 输出 → 前端事件）           │
└───────────────────────────────┬───────────────────────────────────────┘
                                │  stdin / stdout（NDJSON，一行一条消息）
┌───────────────────────────────▼───────────────────────────────────────┐
│  Python: src/ops_agent/bridge/                                        │
│    sidecar.py    stdio 传输层与进程入口                               │
│    server.py     RPC 方法实现，驱动 Kernel + 事件泵                   │
│    protocol.py   NDJSON 分帧、消息构造、错误码（纯契约）               │
│    pending.py    待决请求表与协作式取消                               │
│    serialize.py  领域对象 → 前端 JSON（含出站脱敏）                    │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                          Kernel（既有插件化核心）
```

**关键点：Rust 层不做任何业务逻辑。** 它只负责「把字节搬过去」，所有语义都在 Python 侧，
前端也不会复刻任何权限判断 —— 单一事实来源始终是 Kernel。

## 通信协议

换行分隔的 JSON（NDJSON），一行一条消息，遵循 JSON-RPC 2.0 的子集：

```jsonc
// 前端 → 后端（请求）
{"jsonrpc":"2.0","id":1,"method":"run","params":{"prompt":"查磁盘","host":"demo-host"}}

// 后端 → 前端（响应：带 id）
{"jsonrpc":"2.0","id":1,"result":{"text":"…","steps":[…],"deniedCount":1}}

// 后端 → 前端（推送：**没有 id**）
{"jsonrpc":"2.0","method":"event","params":{"type":"tool.before","ts":1757…,"data":{…}}}
```

**`id` 的有无就是「应答」与「推送」的判别依据** —— 这一条约定让前端只用一个
`onNotification` 订阅就能拿到全部实时事件。

### 方法一览

| 方法 | 用途 |
| :--- | :--- |
| `ping` | 探活 |
| `configure` | 切换适配器 / 事件流路径（重建 Kernel） |
| `status` | Kernel 快照：插件、工具、能力、事件数 |
| `run` | **执行一次诊断**（可取消，事件实时推送） |
| `checkCommand` | 只做权限校验，不连主机 |
| `permission` | 三层规则清单 |
| `replay` | 回放已落盘的 JSONL 事件流 |
| `cancel` | 取消在途请求（不带 id 即取消当前所有） |

## 运行

前置：Node 18+、Rust 1.77+、WebView2（Windows 10/11 通常自带）。

```bash
# 1) 先装好 Python 侧（仓库根目录）
python -m venv .venv && .venv/Scripts/activate
pip install -e ".[dev]"

# 2) 装前端依赖
cd desktop && npm install

# 3) 开发模式（热重载）
npm run tauri:dev

# 4) 打包
npm run tauri:build
```

只想看前端效果（不起 Tauri 窗口）：

```bash
npm run dev        # http://localhost:5183
```

> 注意：在浏览器里直接打开时，`invoke` 不可用，界面会停在「后端异常」。
> 完整功能必须在 Tauri 窗口里跑。

### 只用 cargo 编译（不起 Tauri CLI）

`tauri` 命令是个薄包装，最终调用的还是 cargo。想绕开 Node / Tauri CLI
只验证 Rust 侧，直接进 `src-tauri/`：

```bash
cd desktop/src-tauri

cargo check            # 最快：只做类型检查，不产出二进制
cargo check --message-format short   # 输出更紧凑，适合贴 CI 日志

cargo build            # 只编译 Rust —— 产物**不能独立运行**（见下）

# 要得到可独立运行的产物，必须带上 custom-protocol，把前端资源嵌入二进制
cargo build --features custom-protocol
cargo build --release --features custom-protocol

cargo clippy --all-targets   # 额外 lint（rustup component add clippy）
cargo fmt                     # 格式化（rustup component add rustfmt）
```

#### ⚠️ `custom-protocol` 是必须的

Tauri 判断「前端资源从哪来」靠的是这个 feature：

| 编译方式 | 前端来源 | 能独立运行吗 |
| :--- | :--- | :--- |
| `cargo build` | 运行期去连 `devUrl`（开发服务器） | ❌ 得到空白窗口 |
| `cargo build --features custom-protocol` | **编译期嵌入**二进制 | ✅ |
| `tauri build` | 同上（CLI 自动加该 feature） | ✅ |
| `tauri dev` | 开发服务器 + 热重载 | ✅（开发用） |

验证是否真的嵌进去了 —— 搜二进制里的**资源路径键**：

```bash
# 资源内容被 brotli 压缩过，所以搜不到原始界面文案（如「执行时间线」）；
# 但资源路径键是明文，用它判断才可靠
grep -qa "assets/index-" target/debug/ops-agent-desktop.exe \
  && echo "已嵌入" || echo "未嵌入"
```

另一条更权威的判据是看 build script 有没有发 `dev` cfg：

```bash
grep -q "rustc-cfg=dev" target/debug/build/ops-agent-desktop-*/output \
  && echo "dev 模式 → 未嵌入" || echo "prod 模式 → 已嵌入"
```

另外，无论哪种方式，`cargo build` 之前 `desktop/dist/` 都必须已存在
（否则 `generate_context!` 会在编译期报找不到前端资源）。
先跑一次 `npm run build` 或 `node node_modules/vite/bin/vite.js build` 生成它。

#### 按目的选工具

| 目的 | 用什么 |
| :--- | :--- |
| 验证 Rust 代码能编译 | `cargo check` |
| 只要 Rust 侧 debug 二进制（不含前端） | `cargo build` |
| 用 cargo 做出可运行产物 | `cargo build --features custom-protocol` |
| 得到安装包（MSI / NSIS） | `npm run tauri:build` |

### Windows 上编译失败时

如果 `cargo check` 出现 **`rustc.exe` 以 `0xc0000005`（STATUS_ACCESS_VIOLATION）
退出**，且集中在 proc-macro 类 crate（`serde_derive` / `thiserror-impl` /
`darling_macro` / `phf_macros`）—— 这是**环境问题，不是代码问题**。

原因：proc-macro crate 会被编译成 DLL，由 `rustc.exe` 在**编译期加载**。
杀毒软件 / EDR 对「刚写出、立刻被加载」的 DLL 做实时扫描时，
可能阻塞或隔离该文件，导致 rustc 访问违例。

**本项目实测：清掉 target 目录后重建即可恢复。** 按顺序尝试：

```bash
# 1) 首选：清掉可能已损坏/被隔离的产物后重建（本项目就是这样修好的）
cargo clean && cargo check -j 1

# 2) 关增量编译、降并发
CARGO_INCREMENTAL=0 cargo check -j 1     # PowerShell: $env:CARGO_INCREMENTAL="0"

# 3) 把 target 移出被实时扫描的项目盘
CARGO_TARGET_DIR=C:/cargo-target cargo check
```

仍不行就把这些路径加入杀软**排除列表**（长期方案，最有效）：

- `desktop/src-tauri/target/`
- `C:\Users\<你>\.cargo\`（crate 源码与缓存）
- `C:\Users\<你>\.rustup\`（工具链，含 `rustc.exe` 与 `std-*.dll`）

最后手段：换 GNU 工具链（链接器不同，绕开 MSVC 路径）：

```bash
rustup toolchain install stable-x86_64-pc-windows-gnu
rustup target add x86_64-pc-windows-gnu
cargo +stable-x86_64-pc-windows-gnu check
```

## 后端是怎么被拉起来的

`sidecar.rs` 按优先级尝试三种启动方式，命中即用：

1. 仓库内虚拟环境 —— `.venv/Scripts/python.exe -u -m ops_agent.bridge.sidecar`（开发时走这条）
2. PATH 上的 `ops-agent-bridge`（已 `pip install` 到全局环境时）
3. PATH 上的 `python` / `python3` / `py` + `-m ops_agent.bridge.sidecar`

`-u` 是必需的：没有它 Python 会缓冲 stdout，事件就失去了实时性。

进程收尾做了三重保障：`kill_on_drop(true)` + 应用退出时 `kill_blocking()` +
Python 侧读到 EOF 自行退出（`stdin` 关闭 → `readline()` 返回空 → 循环结束）。
不会留下孤儿进程。

## 目录

```text
desktop/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── scripts/
│   ├── generate_icons.py        # 应用图标是生成产物，脚本可复现
│   ├── extract_icons.py         # 从设计稿提取图标精灵（单一事实来源是设计稿）
│   ├── bundle_fonts.py          # 本地打包 Inter / JetBrains Mono（不依赖运行时联网）
│   └── shoot.mjs                # 用 CDP 驱动无头 Chrome 做交互式截图校对
├── src/                         # 前端
│   ├── main.tsx                 # 样式引入顺序：令牌 → 基础 → 组件 → 布局 → 各屏
│   ├── App.tsx                  # 路由（hash）+ 连接状态 + 会话状态
│   ├── components/
│   │   ├── chrome/WindowChrome.tsx   # 自绘标题栏（decorations:false，红黄绿点即窗口控制）
│   │   ├── layout/AppShell.tsx       # PageHeader / Body / Rail / Card / Banner
│   │   ├── layout/SideNav.tsx        # 222px 导航（监控/安全/基础设施 三组）
│   │   ├── ui/IconSprite.tsx         # ⚠️ 自动生成，勿手改（来自设计稿）
│   │   ├── ui/Icon.tsx               # <use href="#id">
│   │   ├── ui/primitives.tsx         # Btn/Tag/Chip/Kpi/Bar/Field/Empty/…
│   │   └── screens/                  # 12 屏 + 设置
│   │       ├── BootScreen.tsx        # 01 启动握手
│   │       ├── OverviewScreen.tsx    # 02 控制台总览
│   │       ├── TimelineScreen.tsx    # 03 执行时间线（核心）
│   │       ├── ReportScreen.tsx      # 04 会话报告
│   │       ├── PermissionScreen.tsx  # 05 权限分层
│   │       ├── CheckerScreen.tsx     # 06 命令校验器
│   │       ├── AuditScreen.tsx       # 07 事件审计（可回放）
│   │       ├── HostsScreen.tsx       # 08 目标主机
│   │       ├── KernelScreen.tsx      # 09 内核插件拓扑
│   │       ├── AdaptersScreen.tsx    # 10 模型适配器
│   │       ├── RulesScreen.tsx       # 11 权限规则（可写，二次确认）
│   │       ├── DisconnectedScreen.tsx# 12 后端断开
│   │       └── SettingsScreen.tsx    # 设置（设计稿无画板，按同一语言补齐）
│   ├── lib/
│   │   ├── nav.ts               # 导航模型与路由
│   │   ├── appCtx.ts            # 跨屏共享上下文
│   │   ├── bridge.ts            # Tauri IPC 抽象（浏览器预览挂接点）
│   │   ├── preview.ts           # ⚠️ 仅 DEV：浏览器预览用的替身后端
│   │   ├── types.ts             # 与 Python serialize.py 一一对应
│   │   ├── rpc.ts               # RPC 客户端（配对/分流/超时）
│   │   ├── api.ts               # 业务方法封装
│   │   ├── timeline.ts          # 事件 → 时间线（纯函数）
│   │   └── config.ts            # localStorage 持久化
│   ├── styles/
│   │   ├── tokens.css           # 设计令牌（逐字来自设计稿）
│   │   ├── fonts.css            # 本地打包字体（勿手改）
│   │   ├── base.css             # 重置 / 滚动条 / .ic
│   │   ├── components.css       # 通用组件（card/btn/tag/tbl/kpi/…）
│   │   ├── layout.css           # 外壳几何（chrome 42 / side 222 / rail 296）
│   │   └── screens/*.css        # 各屏专属
│   └── assets/fonts/*.woff2     # Latin 字体子集
└── src-tauri/                   # Rust 外壳
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json          # 1440×900 · decorations:false
    ├── capabilities/default.json
    ├── icons/
    └── src/
        ├── main.rs
        ├── lib.rs               # 命令注册 + 事件泵
        └── sidecar.rs           # 进程管理
```

## 界面与设计稿的关系

界面以 `design/console-ui.html`（12 个 1440×900 画板）为基准 **1:1 复刻**。
复刻计划与逐屏规格见 [`docs/UI-REFACTOR-PLAN.md`](../docs/UI-REFACTOR-PLAN.md)。

三条工程约定：

1. **设计稿是唯一事实来源。** 颜色、圆角、间距逐值复制，不重新调；
   图标精灵由 `scripts/extract_icons.py` 从设计稿生成。
2. **数据分层标注。** 后端有的接真实数据；没有的（如 7 天趋势、会话索引）
   在界面上标「示例」，绝不伪装成真实运行状态。
3. **作用域隔离。** 局部样式一律用独立类名（如 `.cap-tag`），
   禁止用「容器 + 通用类」—— 那会让通用类的作用域泄漏到整棵子树。

### 浏览器预览（不必编译 Rust）

```bash
cd desktop && npm run dev        # http://localhost:5183
```

开发模式下 `lib/preview.ts` 会挂一个**替身后端**：模拟握手、按剧本推送事件、
返回真实形态的权限/审计数据。所以不用跑 Python、不用跑 Rust，就能审阅全部 12 屏。

- 只在 `import.meta.env.DEV` 且不在 Tauri 里生效，生产构建会被摇树移除
- 未实现的后端方法会返回 `-32601` 并在界面**原样呈现**，不会假装成功
- 想看「跑完一次诊断」的时间线：执行页填指令 → 发送（预览会按剧本推送 18 条事件）

## 设计取舍

**为什么用 stdio 而不是本地 HTTP？**
HTTP 需要挑端口、处理端口占用、还要应付 Windows 防火墙授权弹窗；
stdio 的「进程即边界」更简单也更安全 —— 只有父进程能跟 sidecar 说话。

**为什么取消是「协作式」而不是 `task.cancel()`？**
强制取消会在任意 `await` 点打断协程，可能把 Kernel 留在半初始化状态。
改成工作协程轮询 `pending.should_stop` 自行收尾，取消就变成一次干净的退出。

**为什么事件脱敏放在出站边界做一次？**
事件会同时流向界面、日志和磁盘。在每个调用点记得脱敏是不可靠的；
在 `serialize.py` 的出口统一递归抹掉疑似凭据字段，只有一处需要正确。

**为什么 `timeline.ts` 是纯函数？**
同一套归约既能处理实时事件，也能处理回放（回放只多一个 `seq`），
而且可以脱离 DOM 单测。

## 已知限制

- `run` 目前是**单会话串行**的：Agent 上下文是有状态的，并发跑会互相污染。
- 桌面端固定 `dry_run=True`，即 SSH 走假连接。接真实主机前需要先在
  `configs/default.yaml` 配好认证方式（建议用环境变量，别写明文）。
- Rust 与前端**已本地验证可编译**（`cargo check` 零警告 / `cargo build` 产出二进制 /
  `tsc --noEmit` / `vite build` 通过），但**尚未接入 CI**。
- `npm run build` 在本机偶发段错误（`vite` 直接调用正常）—— 判断为 npm
  包装脚本问题，非项目代码问题。
