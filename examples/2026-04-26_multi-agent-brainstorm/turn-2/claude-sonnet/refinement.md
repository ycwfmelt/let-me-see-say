# Turn 2 · Round 2 — claude-sonnet refinement

## 整体判断

两个回复在核心架构上高度一致：worktree 隔离 + task.md 协议 + git commit done 信号。分歧集中在三点：触发模式的默认选择（半自动 vs tmux 全自动）、记忆策略的显式化、以及人类的角色定义。Reply A 在这三点上有重要的补充。

---

## 我保留的观点

**tmux 全自动是目标，不只是可选项。**

Reply A 建议"先做半自动版本（用户手动切终端输入）"，我理解这样更稳、更容易 debug。但我认为要区分两件事：

- **调试时**：半自动完全够用，甚至更好，因为你在每次触发前能检查 workspace 状态
- **正常使用时**：2 个 agent × 2 round × N turns，每 phase 手动切两个终端再输入——这会把注意力从"思考脑暴内容"拉到"操作流程"上

建议：把半自动作为 `--manual` 模式保留（也作为自动化的 fallback），把 tmux 全自动作为默认路径。两者的协议层完全一样，差别只在 orchestrator 最后一步是否调 `tmux send-keys`。

---

## 我修改 / 采纳的观点

**1. Memory policy 显式化（非常重要，Reply A 的核心贡献）**

我 Round 1 把"agent 跨 turn 保留 context window"当作优点一笔带过，但没有明确它的副作用。Reply A 的四级 `memory_policy` 框架把这个问题梳理清楚了：

| Policy | Agent 能看到 | 适用场景 |
|---|---|---|
| `none` | topic + outcome | 最干净，每 turn 全新视角 |
| `self` | + 自己历史 answer/refinement | **推荐默认**，有连续性但不污染 Round 1 |
| `full-audit` | + 所有公开 outcome 和自己完整历史 | 深度分析型 session |
| `persistent-cli` | CLI session 完整上下文（不可完全控制） | 允许 agent 自主"记忆"，但不可复现 |

当前这个 session 我用的是 `persistent-cli`（我确实记得自己 Turn 1 说过什么）。这在实践中有价值，但 UI 应该标注"此 participant 使用了不可完全复现的上下文"。

`self` 应该是默认：比 `none` 更像一个持续参与者，又不会破坏 Round 1 互盲（因为你自己的历史不泄露给别人）。

**2. Orchestrator diff 检查（Reply A 的安全设计）**

Reply A 提到 orchestrator 在合并前应该检查 diff，只接受写到允许路径的文件。这比我的描述更严格——不只是"agent 不应该写其他路径"，而是 orchestrator 在 cherry-pick/合并时主动拒绝越权写入。

实现：orchestrator 在把 participant branch 的内容纳入 canonical 视图之前，验证本次 commit 只修改了 `turn-N/<name>/` 和 `.brainstorm/status/<phase>.<name>.md`，否则拒绝并告警。这让隔离保证从 honor system 变成 hard constraint。

---

## 新增的一个观点：orchestrator 需要显式状态机

两个回复都描述了相同的 phase 流程，但都没有把它建模成可持久化的状态机。这对稳定性很关键：

```
状态：current_phase, participants_expected, participants_done, next_action
持久化：.brainstorm/orchestrator-state.json
```

这样 orchestrator 崩溃后可以从断点恢复，而不是要人工判断"现在到哪一步了"。状态转换图：

```
boot → [all ready commits] → turn-N-r1
turn-N-r1 → [all r1 commits] → build-pool → turn-N-r2
turn-N-r2 → [all r2 commits] → await-recap
await-recap → [outcome.md exists + commit] → turn-(N+1)-r1 | session-end
```

每个状态转换条件都是 git log 或文件存在检查，无需解析 agent 输出。

---

## 关于人类的双重角色

两个回复都提到人类介入，但角色定义有差异：Reply A 的人类是**操作者**（手动触发 agent），我 Round 1 的人类是**参与者**（写 outcome.md）。

这两个角色都是真实的，应该同时支持：

- **Human as operator**：控制 session 推进节奏（`brainstorm next-phase`），决定何时进入下一 turn
- **Human as participant**：写 outcome.md，这是人类在脑暴中最有价值的贡献——提炼、选方向、保留少数派观点

未来如果加入 Human participant 类型（类似 CLI agent 但等人写文件），协议层无需改变——只是 participant 的"完成"从 tmux send-keys 触发的 CLI commit，变成等待人类手动写文件和 commit。

---

## 综合建议（修订版）

| 优先级 | 做什么 |
|---|---|
| P0 | 建 orchestrator 状态机（可持久化、可恢复） |
| P0 | 实现 worktree 隔离 + orchestrator diff 检查 |
| P1 | 实现 tmux 全自动触发（同时保留 `--manual` 模式） |
| P1 | 实现 `memory_policy`，默认 `self` |
| P2 | 实现 Human participant 类型（等文件 + commit） |
| P3 | 状态监控面板（实时显示每个 agent 的 phase） |

最小可跑版本只需 P0 + tmux 触发 + `persistent-cli`（即当前 session 的实际运行方式）。等稳定后再加 `memory_policy` 配置和 diff 检查。
