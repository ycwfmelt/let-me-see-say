# Turn 2 · Round 1 — claude-sonnet

## Turn 1 outcome 带来的约束

用户用的是订阅制 CLI（Claude Code、Codex），不是 API 计费。这不是一个小细节——它**从根本上决定了架构必须选 tmux + git 路线**，而不是"可选项之一"。

Turn 1 我列出三条路线，路线 A（API 直调）对这个场景根本不可用。路线 B（tmux 长生 session）是唯一出路。Turn 2 要深入的就是：在这个约束下，这条路线具体怎么做稳。

---

## 订阅 CLI vs API 的本质差异

| 维度 | API 调用 | 订阅 CLI（`claude`/`codex`） |
|---|---|---|
| 触发方式 | HTTP 请求，程序直接控制 | `tmux send-keys`，间接触发 |
| 完成检测 | HTTP 响应返回即完成 | 需要外部信号（git commit） |
| 上下文持久 | 每次调用独立（或手动传 history） | session 内天然连续 |
| 工具使用 | 通过 API tool_use 字段 | agent 自主调用文件、bash、git |
| 并发控制 | asyncio.gather，程序控制 | tmux session 并发，OS 层控制 |
| 错误处理 | HTTP 状态码，可 retry | 需要检测 pane 状态，复杂 |

核心结论：订阅 CLI 给你的是**更强的 agent 能力**（完整工具调用、跨 turn 记忆），代价是**更弱的编排可控性**（无法程序化读取输出、无法精确控制 retry）。

---

## 让 tmux + git 架构跑稳的关键设计

### 1. done 信号：git commit subject 精确匹配

orchestrator 轮询 `git log --oneline` 检测特定格式的 subject（如 `turn-2: claude-sonnet`）。这个设计的关键：

- Subject 格式必须 **100% 确定性**——agent 不能自由发挥措辞
- task.md 里必须写明确的 commit 指令（包括完整的 subject 字符串）
- Orchestrator 应该轮询 **participant branch**，不是 main branch

**风险**：agent 忘记 commit、commit 了但 subject 不对、commit 到错误分支。  
**缓解**：task.md 里把 git 命令写成可直接复制的 code block；agent 在 session 内有 context，能记住。

### 2. 任务投递：task.md + send-keys "Read ... and proceed."

这个协议的优雅之处：orchestrator 只需要发一句话，真正的任务内容在文件里。好处：
- send-keys 的字符串永远简单，不会因为任务复杂而出 shell 转义问题
- task.md 可以是 markdown，格式丰富，agent 能理解结构
- 任务内容可以在 send-keys 之前就写好，甚至提前审查

**注意**：send-keys 之后要发 `Enter`（`\n`），否则命令不会执行。tmux 的 `send-keys` 和 `send-keys -l` 行为有细微差异，要测试清楚。

### 3. 隔离：worktree-per-participant

每个 agent 在独立 git worktree 里工作，写自己专属路径（`turn-N/<agent>/`）。这保证：
- Agent A 的文件系统视图里看不到 Agent B 正在写的文件（除非 orchestrator 显式 cp）
- 即使 agent 失控乱写，也只污染自己的 worktree，不影响其他 agent
- git 操作在各自 worktree 里独立，不会出现分支冲突

**Round 1 互盲的实现**：orchestrator 在 Round 1 期间根本不把其他 agent 的文件放进任何 agent 的 worktree。物理隔离，不靠 honor system。

### 4. 信息流控制：orchestrator 是唯一的"快递员"

```
Round 1:
  orchestrator → task.md (只含 topic) → [trigger all agents]
  agents → turn-N/<agent>/answer.md → git commit
  orchestrator 等所有 commit 到位

Round 2:
  orchestrator → 聚合所有 answer.md → round-1-pool.md (匿名化)
  orchestrator → task.md (含 pool 路径) → [trigger all agents]
  agents → turn-N/<agent>/refinement.md → git commit

Recap:
  orchestrator (+ human) → turn-N/outcome.md
  → 下一 turn 的 task.md 引用此 outcome
```

这个流程里，agent 永远只"推"（写文件、commit），orchestrator 负责"拉"（读文件、汇总、再投递）。Agent 之间没有直接通信。

---

## Human participant 的自然位置

Recap 阶段（生成 outcome.md）是人类介入的天然节点：
- 人类读所有 agent 的 Round 2 refinement
- 人类决定下一 turn 的方向（不是简单摘要，而是"追问什么"）
- outcome.md 是人类的"turn"——和 agent 的 answer.md 地位对等

这意味着系统天然支持 human-in-the-loop，不需要为此做特殊设计。只需要 orchestrator 在 recap 阶段等人类写完 outcome.md（检测文件存在 + commit）再触发下一 turn。

---

## 混合架构：未来加入 API 模型

如果以后想加 GPT-4 或 Gemini（无订阅 CLI），orchestrator 可以做成：
- 订阅 CLI agent → tmux 触发 + git commit 检测
- API 模型 → asyncio HTTP 调用，结果直接写进对应 worktree 文件，orchestrator 模拟 commit

从 Round 2 pool 的视角看，两种 participant 完全对称——都是"一个文件，一个 commit"。Orchestrator 处理不同类型的 participant，但协议层不变。

---

## 当前架构最脆弱的点

1. **Agent 挂起/卡住**：没有 HTTP timeout，需要 orchestrator 设定 wall-clock timeout，超时后人工介入或 kill pane
2. **tmux session 意外关闭**：agent context window 丢失，需要重启 session 并重新投递 task
3. **Commit subject 不匹配**：orchestrator 等待超时，需要人工检查 git log

这三个点都指向同一个需求：orchestrator 需要一个**状态监控面板**，实时显示每个 agent 的当前 phase 和 commit 状态，而不是盲等。

---

## 总结

订阅 CLI 约束让 tmux + git 从"可选路线 B"变成了"唯一路线"。这个架构的核心稳定性来自两点：**task.md 协议简单明确**（agent 不会误解任务），**git commit 作 done 信号可靠**（不依赖 pane 输出解析）。最脆弱的地方是 agent 卡住时的人工干预路径，值得在 MVP 阶段就设计清楚。
