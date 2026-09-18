# AGENTS.md — Agent 开发指南

本文件用于指导 AI Agent 在本项目中协作开发。
所有 Agent 在修改代码前必须阅读本文件，并遵守其中的约定。

## 1. 项目定位

**OpsAgent** 是一个基于 SSH 的智能运维 Agent，核心目标是：

1. 在**严格权限控制**下，让 LLM 自动执行只读诊断类运维任务
2. 采用 **DeepSeek Harness 风格的插件化架构**，所有能力均可热插拔
3. 所有操作**可审计、可追溯、可回放**

## 2. 架构原则（不可违背）

### 2.1 一切皆插件

- 模型适配器、工具、权限控制器、上下文管理器**全部是插件**
- 没有任何「特权内核」——Kernel 只负责插件加载、卸载、依赖管理
- 新增能力 = 新增插件，**不允许**在内核中添加业务逻辑

### 2.2 能力三角色

每个能力（Capability）必须拆分为三层：

| 角色 | 职责 | 位置 |
|------|------|------|
| **Definition** | 纯契约：接口、数据类型、错误定义 | `*/base.py` |
| **Provider** | 具体实现，自注册到 Kernel | `*/<impl>.py` |
| **Consumer** | 使用该能力，写入工具注册表或事件流 | `agent/` 或 `tools/` |

**禁止**在 Definition 中引入任何实现依赖。

### 2.3 可逆副作用

任何插件在运行时对 Kernel 的修改（注册事件、启动定时器、占用资源）**必须同时登记撤销动作**：

```python
# ✅ 正确
def register(self, ctx):
    handle = ctx.events.on("tool.before", self.on_tool_before)
    ctx.on_unload(lambda: ctx.events.off("tool.before", handle))

# ❌ 错误：卸载时无法清理
def register(self, ctx):
    ctx.events.on("tool.before", self.on_tool_before)
```

### 2.4 会话事件流

- 所有 Agent 行为必须写入 **append-only** 的会话事件流
- 事件类型定义在 `session/event.py`，**不允许**随意新增字段
- 事件流是审计、压缩、回放的唯一数据源

## 3. 代码规范

### 3.1 Python 风格

- Python 3.11+，使用 `from __future__ import annotations`
- 类型注解**必须完整**，函数签名不得省略
- 使用 `dataclass` 定义数据结构，`Protocol` 定义接口
- 异步函数统一加 `async` 前缀无强制要求，但 IO 操作**必须** async

### 3.2 命名约定

| 类型   | 命名                | 示例                         |
| :----- | :------------------ | :--------------------------- |
| 插件   | `<name>_plugin`     | `ssh_execute_plugin`         |
| 工具类 | `<Name>Tool`        | `SSHExecuteTool`             |
| 权限层 | `Layer<N><Name>`    | `Layer1Blacklist`            |
| 事件   | `<domain>.<action>` | `tool.before`, `ssh.connect` |

### 3.3 文件组织

- 一个插件一个文件，**不允许**把多个插件塞进同一文件
- `__init__.py` 只做导出，**不允许**包含业务逻辑
- 测试文件与源文件目录结构**镜像对应**

## 4. 安全约束（最高优先级）

### 4.1 绝对禁止

- ❌ 跳过权限检查直接执行 SSH 命令
- ❌ 在日志中打印 API Key、密码、私钥
- ❌ 使用 `shell=True` 且未做 `shlex.quote()` 转义
- ❌ 允许 Agent 修改 `/etc/ssh/sshd_config` 等关键配置
- ❌ 在未确认的情况下执行 `rm` / `kill` / `systemctl restart`

### 4.2 必须遵守

- ✅ 所有 SSH 命令执行前必须经过 **5 层权限校验**
- ✅ 所有用户输入拼接进 shell 命令前必须 `shlex.quote()`
- ✅ 所有危险操作必须写入审计日志（含时间戳、主机、命令、结果）
- ✅ 默认以**只读模式**运行，写操作需显式开启
- ✅ 连接失败时**不重试超过 3 次**，避免暴力尝试

### 4.3 权限层开发要求

新增权限层时必须：

1. 继承 `PermissionLayer` 基类，实现 `check(call) -> Decision`
2. 在 `configs/permission_rules.yaml` 中提供默认规则
3. 编写单元测试，覆盖通过/拒绝/边界三种情况
4. 在 README 权限表中登记

## 5. 开发工作流

### 5.1 新增一个工具插件

```bash
# 1. 在 tools/ 下创建文件
touch src/ops_agent/tools/ssh_disk_usage.py

# 2. 实现 Tool 基类
# 3. 在 __init__.py 中导出
# 4. 编写测试
# 5. 更新 README 的特性列表
```

### 5.2 新增一个模型适配器

参考 `adapters/deepseek.py`，必须实现：

```python
class BaseModelAdapter(Protocol):
    async def chat(self, messages: list[Message], tools: list[Tool]) -> Response: ...
    def supports_function_calling(self) -> bool: ...
```

### 5.3 提交前检查清单

- [ ] 所有新增代码有类型注解
- [ ] 所有新插件实现了 `on_unload` 清理
- [ ] 所有 SSH 操作经过权限校验
- [ ] 单元测试覆盖新增逻辑
- [ ] README / AGENTS.md 同步更新
- [ ] `ruff check` 和 `mypy` 通过

## 6. 测试要求

- 单元测试覆盖率 **≥ 70%**
- 权限层测试**必须**包含绕过尝试（如 `rm -rf /` 的变形写法）
- Agent Loop 测试使用 **mock LLM**，不依赖真实 API
- SSH 测试使用 `pytest-asyncio` + mock AsyncSSH

## 7. 与人类协作的约定

- **不要**自动执行 `git commit` 或 `git push`，除非明确要求
- **不要**修改 `configs/permission_rules.yaml` 的默认规则，除非明确要求
- **不要**在未读 README 的情况下修改核心 Kernel
- 遇到架构决策**必须**先提出方案，等待确认后再实现
- 涉及安全边界的改动**必须**明确标注风险

## 8. 关键文件索引

| 文件                   | 职责           | 修改风险 |
| :--------------------- | :------------- | :------- |
| `kernel/container.py`  | 插件容器核心   | 🔴 高     |
| `kernel/capability.py` | 能力三角色基类 | 🔴 高     |
| `permission/*.py`      | 权限层         | 🔴 高     |
| `agent/loop.py`        | Agent 主循环   | 🟡 中     |
| `tools/*.py`           | 工具插件       | 🟢 低     |
| `adapters/*.py`        | 模型适配器     | 🟢 低     |
| `configs/*.yaml`       | 配置           | 🟡 中     |

## 9. 参考实现

- `pydsh`：DeepSeek Harness 的 Python 复现，Kernel 与能力三角色可参考
- `nano-claude-code-python`：Agent Loop 与工具调用循环的极简实现
- `pydantic-deep`：插件化组织与上下文压缩的生产级范例

## 10. 问题升级路径

遇到以下情况**必须**暂停并向人类确认：

1. 需要新增权限层级或修改现有层级逻辑
2. 需要引入新的第三方依赖
3. 需要修改 Kernel 的插件加载机制
4. 发现现有架构无法满足需求
5. 涉及生产环境凭证或真实主机操作

---

**最后更新**：项目初始化时创建  
**维护者**：项目作者  
**适用 Agent**：Claude Code / Cursor / Cline / 其他代码 Agent
