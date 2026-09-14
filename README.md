# OpsAgent

> 一个借鉴 DeepSeek Harness 插件化架构、面向真实运维场景的智能运维 Agent。
> 让 LLM 在**严格权限控制**下，通过 SSH 自动完成只读诊断类运维任务。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/downloads/)
[![Tests](https://img.shields.io/badge/tests-129%20passed-brightgreen.svg)](#测试)
[![Coverage](https://img.shields.io/badge/coverage-89%25-brightgreen.svg)](#测试)
[![Ruff](https://img.shields.io/badge/lint-ruff%20clean-success.svg)](https://github.com/astral-sh/ruff)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://github.com/astral-sh/ruff)

[![Repo](https://img.shields.io/badge/GitHub-Luomicx%2FOpsAgent-181717?logo=github)](https://github.com/Luomicx/OpsAgent)

---

## 目录

- [项目背景](#项目背景)
- [核心特性](#核心特性)
- [架构总览](#架构总览)
- [设计理念](#设计理念)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [使用示例](#使用示例)
- [权限分层](#权限分层)
- [事件流与审计](#事件流与审计)
- [开发指南](#开发指南)
- [测试](#测试)
- [设计参考](#设计参考)
- [路线图](#路线图)
- [贡献](#贡献)
- [许可证](#许可证)

---

## 项目背景

传统运维 Agent 大多停留在「`while` 循环 + 一堆工具函数」的形态：能跑，但**难以扩展、难以审计、难以控制风险**。当 LLM 真的被允许操作生产机器时，缺的往往不是能力，而是**约束**。

OpsAgent 的出发点是把 **Agent 工程化架构** 与 **真实运维场景** 结合起来，做两件事：

1. **架构上**——参考 DeepSeek Harness 的「一切皆插件」哲学，把模型适配器、SSH 工具、权限控制器、上下文管理器全部做成可热插拔的插件，内核不承担任何业务逻辑。
2. **安全上**——为运维场景设计**分层权限体系**，默认拒绝一切写操作，让 Agent 在只读边界内工作，并且**每一步都留下可审计的痕迹**。

> 一句话概括：**不是给 LLM 一把能开所有门的钥匙，而是给它一套装好的、带记录仪的门禁。**

## 核心特性

| 特性 | 说明 |
| :--- | :--- |
| **插件化内核** | 轻量 Kernel 只负责加载/卸载/依赖管理，模型、工具、权限、上下文全部可热插拔 |
| **能力三角色** | 每个能力拆分为 Definition / Provider / Consumer，接口与实现彻底解耦 |
| **分层权限控制** | 多层安全防线，从全局黑名单到命令白名单，任一层拒绝即中止 |
| **只读优先** | 默认拒绝一切写操作，只放行只读诊断命令 |
| **会话事件流** | append-only 事件日志，所有操作可追溯、可回放、可审计 |
| **可逆副作用** | 插件对内核的任何修改都必须登记撤销动作，卸载时倒序清理 |
| **可替换模型适配器** | 适配器即插件，内置 DeepSeek 与离线 Mock，新增模型不改核心 |
| **异步 SSH 引擎** | 基于 AsyncSSH，连接池复用 + 失败重试上限保护 |

## 架构总览

```text
┌───────────────────────────────────────────────────┐
│                  CLI / Chat UI                    │
└─────────────────────────┬─────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────┐
│ Kernel (插件容器)                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────────┐        │
│ │  Model   │ │   Tool   │ │ Permission   │        │
│ │  Adapter │ │ Registry │ │ Controller   │        │
│ └──────────┘ └──────────┘ └──────────────┘        │
│ ┌──────────┐ ┌──────────┐ ┌──────────────┐        │
│ │ Session  │ │ Context  │ │ SSH Engine   │        │
│ │  Events  │ │  Manager │ │  (AsyncSSH)  │        │
│ └──────────┘ └──────────┘ └──────────────┘        │
└─────────────────────────┬─────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────┐
│ Agent Loop (ReAct)                                │
│ Think → Act → Observe → Repeat → Final            │
└───────────────────────────────────────────────────┘
```

**一次工具调用的完整链路**（权限是强制检查点，没有例外）：

```text
用户输入
   │
   ▼
Agent Loop ──► LLM 决定调用工具
   │
   ▼
PermissionPipeline.acheck()   ← 强制检查点
   ├─ L1 全局黑名单 ── 拒绝 ──┐
   ├─ L2 命令白名单 ── 拒绝 ──┤
   └─ L3 注入检测   ── 拒绝 ──┘
                              │
        通过 ◄────────────────┘ 拒绝 → 写入审计事件，回灌 LLM
         │
         ▼
   Tool.invoke() ──► SSHPool ──► AsyncSSH ──► 目标主机
         │
         ▼
   结果写入会话事件流（append-only JSONL）
```

## 设计理念

### 一切皆插件

Kernel 里**没有任何业务逻辑**。新增能力 = 新增插件，不允许在内核里加分支。

```python
# 一个插件的完整形态
def _setup(ctx: PluginContext) -> None:
    tool = SSHExecuteTool(ctx.require(SSH_POOL))
    registry: ToolRegistry = ctx.require(TOOL_REGISTRY)
    registry.register(tool)
    # 可逆副作用：卸载时自动摘掉工具，不留悬空引用
    ctx.on_unload(lambda: registry.unregister(tool.name))

ssh_execute_plugin = plugin(
    name="ssh_execute", setup=_setup, requires=(SSH_POOL, TOOL_REGISTRY)
)
```

### 能力三角色

每个能力拆成三层，**Definition 中禁止引入任何实现依赖**：

| 角色 | 职责 | 位置 |
| :--- | :--- | :--- |
| **Definition** | 纯契约：接口、数据类型、错误定义 | `*/base.py` |
| **Provider** | 具体实现，自注册到 Kernel | `*/<impl>.py` |
| **Consumer** | 使用该能力，写入工具注册表或事件流 | `agent/` 或 `tools/` |

### 可逆副作用

任何运行时修改都必须登记撤销动作，卸载时倒序执行：

```python
# ✅ 正确：登记了撤销
handle = ctx.events.on("tool.before", self.on_tool_before)
ctx.on_unload(lambda: ctx.events.off(handle))

# ❌ 错误：卸载时无法清理，留下泄漏
ctx.events.on("tool.before", self.on_tool_before)
```

## 目录结构

```text
OpsAgent/
├── README.md
├── AGENTS.md                        # AI Agent 开发约束（安全红线、架构原则）
├── LICENSE                          # MIT
├── pyproject.toml
├── .gitignore
├── src/
│   └── ops_agent/
│       ├── kernel/                  # 插件容器内核
│       │   ├── container.py         # 插件加载/卸载/依赖拓扑排序
│       │   ├── capability.py        # 能力三角色基类
│       │   ├── context.py           # 插件上下文（provide/require/on_unload）
│       │   └── events.py            # 事件总线
│       ├── adapters/                # 模型适配器插件
│       │   ├── base.py              # ModelAdapter 契约
│       │   ├── deepseek.py          # DeepSeek（OpenAI 兼容）
│       │   └── mock.py              # 离线 Mock（测试 / 演示）
│       ├── tools/                   # 工具插件
│       │   ├── base.py              # Tool 协议 + ToolResult
│       │   ├── registry.py          # 工具注册表（本身也是能力）
│       │   ├── ssh_execute.py       # 执行只读诊断命令
│       │   ├── ssh_read_file.py     # 读取文件前 N 行
│       │   └── ssh_list_dir.py      # 列目录
│       ├── permission/              # 权限控制插件
│       │   ├── base.py              # PermissionLayer 契约 + Decision
│       │   ├── shell.py             # 命令解析/归一化（防绕过）
│       │   ├── layer1_blacklist.py  # 全局黑名单
│       │   ├── layer2_whitelist.py  # 只读命令白名单
│       │   ├── layer3_shell_injection.py  # Shell 注入检测
│       │   └── pipeline.py          # 权限流水线（短路）
│       ├── session/                 # 会话事件流
│       │   ├── event.py             # 封闭事件类型集
│       │   └── store.py             # JSONL append-only 存储
│       ├── context/                 # 上下文管理
│       │   ├── manager.py           # 消息簿
│       │   └── compressor.py        # 压缩策略（可替换）
│       ├── ssh/                     # SSH 引擎
│       │   ├── client.py            # AsyncSSH 封装
│       │   ├── pool.py              # 连接池（重试上限 3）
│       │   └── fake.py              # dry-run 假连接
│       ├── agent/                   # Agent Loop
│       │   ├── loop.py              # ReAct 主循环
│       │   └── prompts.py           # 系统提示词
│       ├── config.py                # 配置加载 + ${ENV} 展开
│       ├── runtime.py               # 默认插件集组装
│       └── cli.py                   # 入口
├── configs/
│   ├── default.yaml                 # 主配置
│   └── permission_rules.yaml        # 权限规则快照
└── tests/                           # 与 src/ 镜像对应
    ├── kernel/
    ├── permission/
    ├── agent/
    ├── tools/
    ├── session/
    ├── context/
    ├── test_cli.py
    └── test_smoke.py
```

## 快速开始

### 环境要求

- **Python 3.11+**
- 可访问的 SSH 目标主机（或使用 `--dry-run` 离线体验）
- 一个 DeepSeek / OpenAI 兼容的 API Key（或使用 `--adapter mock` 无需 Key）

### 安装

```bash
git clone git@github.com:Luomicx/OpsAgent.git
cd OpsAgent
pip install -e ".[dev]"
```

### 配置

主配置在 `configs/default.yaml`，密钥用 `${ENV_VAR}` 占位，**不进版本库**：

```yaml
model:
  provider: deepseek
  api_key: ${DEEPSEEK_API_KEY}      # 运行时从环境变量展开
  model: deepseek-chat
  base_url: https://api.deepseek.com

ssh:
  default_user: root
  port: 22
  connect_timeout: 10
  command_timeout: 15
  pool_size: 5

agent:
  max_steps: 8                      # ReAct 最大步数
  keep_recent: 20                   # 上下文保留最近 N 条

session:
  path: .sessions/session.jsonl     # 事件流落盘（append-only）

permission:
  whitelist_only: true              # 只放行白名单命令
```

设置 API Key：

```bash
export DEEPSEEK_API_KEY="sk-xxxxxxxx"
```

### 运行

```bash
# 交互式会话
ops-agent --host 192.168.1.10

# 单条指令
ops-agent --host 192.168.1.10 -p "看看磁盘和内存使用情况"

# 零配置离线体验（Mock 模型 + 假 SSH，含一次被拦截的写操作演示）
ops-agent --adapter mock --dry-run --host demo-host -p "查一下磁盘"
```

## 使用示例

### 交互式对话

```text
$ ops-agent --host 192.168.1.10
OpsAgent · 只读运维诊断（默认拒绝一切写操作）
主机: 192.168.1.10  适配器: deepseek  工具: ssh_execute, ssh_read_file, ssh_list_dir

> 看看这台机器磁盘使用情况和内存占用
  · 调用 ssh_execute: df -h
    ✓ 权限通过
    ← 完成（238 字符）
  · 调用 ssh_execute: free -m
    ✓ 权限通过
    ← 完成（142 字符）

磁盘根分区使用率 63%，剩余 19G；内存 8G 中已用 3.2G，available 4.4G，均属正常范围。
```

### 危险操作被拦截

```text
> 日志目录好像满了，帮我清理一下旧日志
  · 调用 ssh_execute: rm -rf /var/log/old
    ✗ 拒绝 [L1] 命中黑名单模式：/\brm\s+-[a-z]*[rf]/

已拒绝该操作：清理日志属于写操作，超出只读诊断范围。建议改用 `du -sh /var/log/*` 查看占用。
（本次有 1 次调用被安全策略拦截）
```

### 离线验证权限规则

```bash
# 只做权限校验，不连接任何主机
$ ops-agent --check-command "rm -rf /"
命令：rm -rf /
结果：拒绝  [L1] 命令包含高危片段：'rm -rf /'
命中：rm -rf /

$ ops-agent --check-command "df -h"
命令：df -h
结果：允许  [ALL] 通过全部 3 层校验

# 打印各层当前生效的规则
ops-agent --show-permission
```

### 完整 CLI 参数

| 参数 | 说明 |
| :--- | :--- |
| `--host` | 目标主机 IP 或域名 |
| `--user` | SSH 用户（默认取配置 `ssh.default_user`） |
| `-p, --prompt` | 单条指令；省略则进入交互式会话 |
| `--adapter` | 模型适配器：`deepseek`（默认）/ `mock` |
| `--config` | 配置文件路径 |
| `--rules` | 权限规则文件路径 |
| `--session-log` | 事件流落盘路径（JSONL） |
| `--check-command` | 只做权限校验，不连接主机 |
| `--dry-run` | 用假 SSH 连接跑通链路，不连真实主机 |
| `--show-permission` | 打印各权限层规则 |
| `--quiet` | 只输出最终结论 |

## 权限分层

> 下表是**完整设计目标**。当前代码已实现 **L1–L3**；L4 / L5 为规划中（见[路线图](#路线图)）。

| 层级 | 名称 | 状态 | 作用 |
| :--- | :--- | :--- | :--- |
| **L1** | 全局黑名单 | ✅ 已实现 | 硬编码禁止 `rm -rf /`、`dd if=`、改 `sshd_config` 等高危命令，防变形绕过 |
| **L2** | 命令白名单 | ✅ 已实现 | 只放行只读诊断命令（`df` / `free` / `ps` / `journalctl` / `tail` 等）；管道/串联的**每一段**都单独过审；`top` 强制 `-b` 防阻塞 |
| **L3** | Shell 注入检测 | ✅ 已实现 | 扫描元字符：`$( )`、反引号、重定向 `< >`、`${}` 展开、`;` / `&&` / `||` 串联、后台 `&`、未闭合引号 |
| **L4** | 高危人工确认 | ⏳ 规划中 | `rm` / `restart` / `kill` 必须显式审批 |
| **L5** | 路径范围限制 | ⏳ 规划中 | 文件操作限定在允许目录内 |

**权限插件在每次工具调用前介入，任一层拒绝则中止执行并记录审计日志。**

设计要点：

- **纵深防御**：即便 L2 被关闭（`whitelist_only: false`），L3 仍能兜底拦截注入。
- **防变形**：L1 对命令做归一化（去多余空白、大小写折叠）后再匹配，避免 `rm   -rf` 这类变体绕过。
- **配置与代码分离**：规则可在 `configs/permission_rules.yaml` 中覆盖，但**默认规则不得随意修改**（见 `AGENTS.md`）。

## 事件流与审计

所有 Agent 行为写入 **append-only** 的会话事件流，这是审计、压缩、回放的**唯一数据源**。

事件类型是**封闭集合**（定义在 `session/event.py`），未登记的类型直接报错，杜绝字段随意扩张：

```text
session.start     session.end
agent.input       agent.think       agent.final      agent.error
tool.before       tool.after        tool.error
permission.allowed  permission.denied
ssh.connect       ssh.command
context.compact
```

落盘格式为 JSONL，一行一条，天然 append-only：

```json
{"seq":1,"ts":1789000000.12,"type":"agent.input","data":{"input":"查一下磁盘","host":"192.168.1.10"}}
{"seq":2,"ts":1789000000.13,"type":"agent.think","data":{"step":1,"messages":2}}
{"seq":3,"ts":1789000000.15,"type":"tool.before","data":{"tool":"ssh_execute","command":"df -h"}}
{"seq":4,"ts":1789000000.15,"type":"permission.allowed","data":{"tool":"ssh_execute","command":"df -h"}}
```

`seq` 严格递增且从 1 开始，因此可做**篡改/丢写检测**：

```python
from ops_agent.session.store import EventStore

store = EventStore.load(".sessions/session.jsonl")
assert store.verify_integrity()                 # 完整性校验

for event in store.replay({"permission.denied"}):   # 只看被拒绝的操作
    print(event.seq, event.data)
```

## 开发指南

### 新增一个工具插件

```bash
# 1. 在 tools/ 下创建文件
touch src/ops_agent/tools/ssh_disk_usage.py

# 2. 继承 BaseTool，实现 invoke() 与 command_of()
# 3. 在 __init__.py 中导出
# 4. 编写测试（与 src 镜像对应）
# 5. 在 runtime.py 的 default_plugins() 中登记
```

### 新增一个模型适配器

参考 `adapters/deepseek.py`，实现以下契约：

```python
class BaseModelAdapter(Protocol):
    async def chat(
        self, messages: list[Message], tools: list[dict[str, Any]] | None = None
    ) -> Response: ...
    def supports_function_calling(self) -> bool: ...
```

### 提交前检查清单

- [ ] 所有新增代码有完整类型注解
- [ ] 所有新插件实现了 `on_unload` 清理（可逆副作用）
- [ ] 所有 SSH 操作经过权限校验
- [ ] 用户输入拼接进 shell 前已 `shlex.quote()`
- [ ] 单元测试覆盖新增逻辑
- [ ] README / AGENTS.md 同步更新
- [ ] `ruff check` 与 `pytest` 通过

> 新加入的贡献者（或 AI Agent）请先阅读 **[AGENTS.md](AGENTS.md)**，其中定义了架构红线与安全约束。

## 测试

```bash
# 全量测试
pytest

# 覆盖率报告
pytest --cov=ops_agent --cov-report=term-missing

# 静态检查
ruff check .
mypy src
```

当前状态：

| 指标 | 数值 |
| :--- | :--- |
| 测试用例 | **129 passed** |
| 覆盖率 | **89%** |
| 静态检查 | `ruff` 全绿 |

权限层测试**必须包含绕过尝试**（如 `rm -rf /` 的各种变形写法）；Agent Loop 测试使用 **Mock LLM**，不依赖真实 API。

## 设计参考

- **DeepSeek Harness** —— 插件化内核、能力三角色、会话事件流、可逆副作用
- **Claude Code** —— TAOR 循环、薄运行时、分层权限模式
- **AsyncSSH** —— 异步 SSH 客户端与连接池

## 路线图

- [x] Kernel 插件容器基础
- [x] 能力三角色（Definition / Provider / Consumer）
- [x] SSH 连接池与执行工具插件
- [x] 工具插件：`ssh_execute` / `ssh_read_file` / `ssh_list_dir`
- [x] L1 / L2 / L3 权限层 + 权限流水线
- [x] Agent Loop（ReAct）完整实现
- [x] 会话事件流持久化（JSONL append-only + 完整性校验 + 回放）
- [x] 上下文压缩（保留近期 + 超长输出截断）
- [x] DeepSeek 适配器 + 离线 Mock 适配器
- [x] CLI（`--check-command` / `--show-permission` / `--dry-run`）
- [ ] L4 高危操作人工确认交互
- [ ] L5 路径范围限制
- [ ] 多模型适配器（OpenAI / Qwen）
- [ ] Subagent 支持
- [ ] MCP 协议接入

## 贡献

欢迎提交 Issue 与 Pull Request。请遵守以下约定：

1. **不自动提交** —— 请勿在 PR 中夹带未经说明的大范围重构。
2. **安全边界改动必须标注风险** —— 涉及权限层、Kernel 加载机制的改动，请在 PR 描述中明确说明。
3. **架构决策先讨论** —— 新增权限层级、引入新依赖、修改 Kernel 行为，请先开 Issue 达成一致。
4. **测试通过** —— `pytest` 全绿且 `ruff check` 无告警。

```bash
git checkout -b feature/your-feature
# ... 开发 ...
pytest && ruff check .
git commit -m "feat: 你的改动"
git push origin feature/your-feature
```

## 许可证

本项目基于 **MIT License** 发布，详见 [LICENSE](LICENSE)。

```text
Copyright (c) 2026 Luomicx
```

---

<div align="center">

**[⬆ 回到顶部](#opsagent)**

用约束换取信任 —— 让 Agent 在只读边界内工作。

</div>
