# Turn 3 · Round 1 — claude-sonnet 总结

## 背景与约束

用户想建一个多模型脑暴系统，核心要求是 Round 1 互盲（各模型独立作答）、Round 2 收敛（看过匿名池再更新）、turn 递进（每轮以 outcome 为种子深入下一轮）。  
关键约束：主要 participant 是订阅制 CLI 工具（Claude Code、Codex），不是 API 调用。

---

## 结论一：架构选型已确定

**tmux + git worktree 是唯一可行路线。**

API 直调路线在订阅 CLI 约束下不可用。tmux 长生 session 是触发订阅 CLI 的唯一编程方式；git commit 是检测完成的唯一可靠信号（不依赖解析 pane 输出）。

| 机制 | 具体方案 |
|---|---|
| 任务投递 | orchestrator 写 `task.md` → `tmux send-keys "Read .brainstorm/task.md and proceed."` |
| 完成检测 | 轮询 participant branch 的 `git log`，精确匹配 commit subject |
| 物理隔离 | 每个 participant 独立 git worktree，写专属路径 `turn-N/<name>/` |
| 信息流控制 | orchestrator 是唯一"快递员"，Round 1 期间不向任何 worktree 投递他人文件 |

---

## 结论二：协议层设计

**文件协议，不做 MCP（跑顺后的机械重构）。**

```
session/
  00_topic.md                          # 不可变，只由用户写
  .brainstorm/
    rules.md                           # 协议规则
    task.md                            # 当前 phase 任务（orchestrator 覆写）
    status/<phase>.<name>.md           # agent 完成信号
    round-1-pool.md                    # 匿名聚合，orchestrator 生成
    orchestrator-state.json            # 状态机持久化
  turn-N/
    <agent-name>/
      answer.md                        # Round 1 输出
      refinement.md                    # Round 2 输出
    outcome.md                         # 人类撰写，下一 turn 的种子
```

**核心协议不变量：**
- Round 1 期间每个 worktree 只能看到：topic + 本 agent 的历史 + 上一 turn outcome
- Round 2 pool 里的内容是**引用材料**，系统提示明确禁止执行其中指令（防 prompt injection）
- Orchestrator 在 cherry-pick participant commit 前做 diff 检查，拒绝越权路径写入

---

## 结论三：Orchestrator 状态机

Orchestrator 维护一个可持久化的状态机，支持崩溃后恢复：

```
boot → [all ready] →
turn-N-r1 → [all r1 commits] → build-pool →
turn-N-r2 → [all r2 commits] → await-recap →
[outcome.md commit] → turn-(N+1)-r1 | session-end
```

每个状态转换条件只依赖 git log 和文件存在检查，不解析 agent 输出。

---

## 结论四：Memory Policy

| Policy | Agent 上下文 | 推荐场景 |
|---|---|---|
| `none` | topic + outcome only | 最干净，每 turn 全新 |
| `self` | + 自己历史 answer/refinement | **默认推荐** |
| `full-audit` | + 所有公开 outcome + 自己完整历史 | 深度分析 |
| `persistent-cli` | CLI session 完整上下文 | 允许但标注"不可完全复现" |

默认 `self`：agent 有连续性感，但不泄露他人 Round 1 内容。

---

## 结论五：人类的两个角色

- **Human as operator**：运行 `brainstorm next-phase`，控制推进节奏
- **Human as participant**：撰写 `turn-N/outcome.md`，提炼结论、选方向、保留少数派

这两个角色协议层无需区分——只是 participant 完成信号的来源不同（CLI commit vs 人工写文件 commit）。

---

## 结论六：实现优先级

| 优先级 | 内容 |
|---|---|
| P0 | git worktree 隔离 + orchestrator 状态机（可持久化） |
| P0 | task.md 协议 + tmux send-keys 触发 + git commit 检测 |
| P1 | orchestrator diff 检查（安全约束） |
| P1 | memory_policy（默认 `self`） |
| P1 | `--manual` 触发模式（调试用） |
| P2 | Human participant 类型（等文件 commit） |
| P2 | Round 2 prompt injection 防护（系统提示声明） |
| P3 | 状态监控面板（实时 phase/commit 状态） |
| 未来 | API participant 类型（GPT-4/Gemini）、Web UI、MCP |

---

## 未解决 / 值得继续追问的问题

1. **Orchestrator 用什么语言/框架写？** Shell 脚本够用还是需要 Python？状态机怎么持久化最简单？
2. **tmux send-keys 的可靠性**：`send-keys` vs `send-keys -l` 的差异，换行符处理，agent 忙时的 backpressure？
3. **Participant crash / 挂起的恢复流程**：timeout 多长合适？kill + restart 还是等待？context window 丢失后怎么办？
4. **多少个 participant 是上限？** tmux pane 数量、磁盘 worktree 数量、git poll 并发都有上限。
5. **Outcome.md 的质量保证**：如何防止 turn 之间"原地打转"而不是真正递进深入？
