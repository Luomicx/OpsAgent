# OpsAgent — 基于 SSH 的智能运维 Agent

> 一个借鉴 DeepSeek Harness 插件化架构、面向真实运维场景的智能体项目。
> 目标：让 LLM 在严格权限控制下，通过 SSH 自动完成只读诊断类运维任务。

## 项目背景

本项目的出发点是将 **Agent 工程化架构** 与 **真实运维场景** 结合。
传统运维 Agent 大多是「while-loop + 工具函数」的简单堆砌，难以扩展、难以审计、难以控制风险。
本项目参考 DeepSeek Harness 的 **"一切皆插件"** 设计哲学，把模型适配器、SSH 工具、权限控制器、上下文管理器等所有组件都做成可替换插件，同时针对运维场景设计了分层权限体系。

## 核心特性

- **插件化内核**：基于轻量级 Kernel，所有能力（模型、工具、权限、上下文）均可热插拔
- **能力三角色模式**：每个能力拆分为 Definition / Provider / Consumer 三层，接口与实现解耦
- **分层权限控制**：五层安全防线，从全局黑名单到人工确认，杜绝危险命令
- **会话事件流**：append-only 事件日志，所有操作可追溯、可压缩、可审计
- **可替换模型适配器**：支持 DeepSeek / GPT / Qwen 等多模型家族的软映射
- **异步 SSH 引擎**：基于 AsyncSSH，支持连接池与持久化会话

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

## 目录结构

```text
ops-agent/
├── README.md
├── AGENTS.md
├── pyproject.toml
├── .gitignore
├── src/
│   └── ops_agent/
│       ├── kernel/                  # 插件容器内核
│       │   ├── container.py         # 插件加载/卸载/依赖管理
│       │   ├── capability.py        # 能力三角色基类
│       │   ├── context.py           # 插件上下文
│       │   └── events.py            # 事件总线
│       ├── adapters/                # 模型适配器插件
│       │   ├── base.py
│       │   ├── deepseek.py
│       │   └── mock.py
│       ├── tools/                   # 工具插件
│       │   ├── base.py
│       │   ├── registry.py
│       │   ├── ssh_execute.py
│       │   ├── ssh_read_file.py
│       │   └── ssh_list_dir.py
│       ├── permission/              # 权限控制插件
│       │   ├── base.py
│       │   ├── shell.py             # 命令解析/归一化工具
│       │   ├── layer1_blacklist.py
│       │   ├── layer2_whitelist.py
│       │   ├── layer3_shell_injection.py
│       │   └── pipeline.py
│       ├── session/                 # 会话事件流
│       │   ├── event.py
│       │   └── store.py
│       ├── context/                 # 上下文管理
│       │   ├── manager.py
│       │   └── compressor.py
│       ├── ssh/                     # SSH 引擎
│       │   ├── client.py
│       │   ├── pool.py
│       │   └── fake.py              # dry-run 假连接
│       ├── agent/                   # Agent Loop
│       │   ├── loop.py
│       │   └── prompts.py
│       ├── config.py                # 配置加载
│       ├── runtime.py               # 默认插件集组装
│       └── cli.py                   # 入口
├── configs/
│   ├── default.yaml
│   └── permission_rules.yaml
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

- Python 3.11+
- 可访问的 SSH 目标主机
- DeepSeek / OpenAI API Key

### 安装

```bash
git clone <your-repo>
cd ops-agent
pip install -e ".[dev]"
```

### 配置

复制 `configs/default.yaml.example` 为 `configs/default.yaml`，填入：

```yaml
model:
  provider: deepseek
  api_key: ${DEEPSEEK_API_KEY}
  model: deepseek-chat

ssh:
  default_user: root
  connect_timeout: 10
  pool_size: 5

permission:
  confirm_required:
    - "rm"
    - "systemctl restart"
    - "kill"
  whitelist_only: true
```

### 运行

```bash
ops-agent --host 192.168.1.10
```

然后在交互式界面中输入自然语言指令，例如：

```text
> 看看这台机器磁盘使用情况和内存占用
> 帮我查一下最近 100 行 nginx 错误日志
> 检查一下 8080 端口有没有被占用
```

## 权限分层设计

> 下表是**完整设计目标**。当前代码已实现 L1–L3；L4 / L5 为规划中（见开发路线）。

| 层级 | 名称           | 状态 | 作用                                                              |
| :--- | :------------- | :--- | :---------------------------------------------------------------- |
| L1   | 全局黑名单     | 已实现 | 硬编码禁止 `rm -rf /`、`dd if=`、修改 sshd_config 等              |
| L2   | 命令白名单     | 已实现 | 只放行只读诊断命令（`df` / `free` / `ps` / `journalctl` / `tail` 等） |
| L3   | Shell 注入检测 | 已实现 | `shlex.quote()` 转义 + 元字符扫描                                 |
| L4   | 高危人工确认   | 规划中 | `rm` / `restart` / `kill` 必须显式审批                            |
| L5   | 路径范围限制   | 规划中 | 文件操作限定在允许目录内                                          |

**权限插件在每次工具调用前介入，任一层拒绝则中止执行并记录审计日志。**

## 设计参考

- **DeepSeek Harness**：插件化内核、能力三角色、会话事件流、可逆副作用
- **Claude Code**：TAOR 循环、薄运行时、分层权限模式
- **AsyncSSH**：异步 SSH 客户端与连接池

## 开发路线

- [x] Kernel 插件容器基础
- [x] 能力三角色（Definition / Provider / Consumer）
- [x] SSH 连接池与执行工具插件
- [x] 工具插件：`ssh_execute` / `ssh_read_file` / `ssh_list_dir`
- [x] L1/L2/L3 权限层 + 权限流水线
- [x] Agent Loop（ReAct）完整实现
- [x] 会话事件流持久化（JSONL append-only + 完整性校验 + 回放）
- [x] 上下文压缩（保留近期 + 超长输出截断）
- [x] DeepSeek 适配器 + 离线 Mock 适配器
- [x] CLI（`--check-command` / `--show-permission` / `--dry-run`）
- [ ] L4 人工确认交互
- [ ] L5 路径范围限制
- [ ] 多模型适配器（OpenAI / Qwen）
- [ ] Subagent 支持
- [ ] MCP 协议接入

## License

MIT
