# Turn 2 independent answer

上一轮 outcome 提出的关键约束是：Claude Code 和 Codex 都是订阅制 CLI，而不是 API 计费，所以不能简单假设 orchestrator 可以直接用 API 调所有模型。

这会改变实现优先级。我现在会把方案改成 **CLI-agent-first 的本地编排系统**，API adapter 反而只是可选补充。

## 核心判断

如果主要参与者是 Claude Code、Codex 这类 CLI agent，那么最佳协议不是“一个后端服务调用多个 LLM API”，而是：

**一个 orchestrator 管多个隔离 workspace，每个 CLI agent 在自己的 workspace 里读任务、写答案、提交完成信号。**

这其实更贴近你要的脑暴模式，因为 CLI agent 本来就是“工作者”而不是“单次 completion”。它们可以读文件、产出 Markdown、提交 git commit，也能自然地跨 turn 参与。但是隔离边界要靠文件系统、git 分支和任务文件控制，而不是靠 prompt 约束。

## 推荐架构

一个 session 用一个 git repo 管理，结构类似：

```text
00_topic.md
.brainstorm/
  rules.md
  task.md
  status/
  round-1-pool.md
turn-1/
  codex/answer.md
  claude/answer.md
  outcome.md
turn-2/
  codex/answer.md
  claude/answer.md
```

每个 participant 有自己的 branch/worktree：

```text
workspaces/
  session-id/
    orchestrator/
    participants/
      codex/
      claude/
```

orchestrator 只做几件事：

- 写 `.brainstorm/task.md`。
- 控制哪些文件进入 participant workspace。
- 启动或提示对应 CLI agent 继续工作。
- 监听 git commit 或 `.brainstorm/status/*.md`。
- 收齐 Round 1 后生成 anonymized pool。
- 收齐 Round 2 后生成或请求 human 生成 outcome。

## 为什么不要只靠同一个目录

如果 Claude Code 和 Codex 在同一个工作目录里跑，就很容易破坏第一轮互盲：

- 某个 agent 可能 `find` 到另一个 agent 的文件。
- 某个 agent 可能看到 git status 里未提交的其他输出。
- Round 1 期间如果池文件提前出现，就会污染后续回答。

所以每个 agent 最好是独立 worktree，至少要独立目录。Round 1 时，它的目录里只应该有：

- `00_topic.md`
- `.brainstorm/rules.md`
- `.brainstorm/task.md`
- 如果是 turn > 1，再加上一轮 `outcome.md`
- 它自己过去的文件，如果你允许 participant 记住自己的历史

不应该有其他 participant 的 Round 1 输出。

## 两种可行操作模式

### 1. 半自动模式，最稳

orchestrator 准备好每个 workspace 和 task 后，用户手动切到对应终端，输入：

```text
Read .brainstorm/task.md and proceed.
```

每个 CLI agent 完成后自己 commit。orchestrator 轮询 git log，看到指定 commit subject 就进入下一 phase。

这个模式最不脆弱，也最符合订阅 CLI 的正常使用方式。缺点是需要人点几下终端。

### 2. tmux 自动投递模式，体验更好但更脆

orchestrator 为每个 agent 开一个 tmux pane/window：

```text
tmux new-session -s brainstorm
tmux new-window -n codex
tmux new-window -n claude
```

然后通过 `tmux send-keys` 把同一句触发语发给对应 CLI：

```text
Read .brainstorm/task.md and proceed.
```

完成信号仍然用 git commit 或 status file，不要靠解析终端输出。这样即使 CLI 输出格式变化，orchestrator 也不会太容易坏。

这个模式要接受两个现实：

- CLI TUI 可能变化，自动输入会有维护成本。
- 不要做绕过订阅限制、批量刷请求、规避 rate limit 的东西；只把它当成本地多终端工作流自动化。

## 第一版 MVP 怎么做

我会先做半自动版本，避免把精力耗在 TUI 自动化上。

最小命令集：

```text
brainstorm init "topic"
brainstorm add-participant codex --workspace ./participants/codex
brainstorm add-participant claude --workspace ./participants/claude
brainstorm start-turn
brainstorm status
brainstorm build-pool
brainstorm start-round2
brainstorm draft-outcome
```

每一 phase 的机制：

1. orchestrator 给每个 participant 写 task。
2. 用户或 tmux 触发 CLI agent。
3. agent 写自己的答案和 status。
4. agent commit，subject 必须精确匹配，例如 `turn-2: codex`。
5. orchestrator 收齐 commit 后推进。

这套机制的好处是非常容易 debug：任何时候卡住了，只要看 git log、status 文件、task 文件就知道问题在哪里。

## 关于记忆

CLI agent 最大诱惑是“它在自己的对话里会记得前面聊过什么”。但我仍然建议默认不要依赖这种隐藏记忆。

原因是你的目标是多模型脑暴，不只是连续聊天。为了让结果可审计，下一 turn 默认输入应该是：

- 原始 topic
- 上一 turn outcome
- 可选：该 participant 自己上一轮 answer/refinement

不应该默认包含所有历史全文，更不应该依赖 CLI 会话里不可见的上下文。可以提供一个 `memory_policy`：

- `none`：每 turn 只看 topic + outcome。
- `self`：还能看自己过去的回答。
- `full-audit`：看所有公开 outcome 和自己完整历史。
- `persistent-cli`：允许 CLI 自己保留会话上下文，但 UI 必须标注“不可完全复现”。

我会把 `self` 作为默认，比 `none` 更像一个持续参与者，又不会破坏 Round 1 互盲。

## 安全边界

因为 CLI agent 有文件读写能力，协议要明确：

- participant 只能写 `turn-N/<name>/...` 和 `.brainstorm/status/<phase>.<name>.md`。
- 不能修改 `00_topic.md`、pool、outcome、rules、其他 participant 文件。
- Round 1 workspace 不包含其他人的答案。
- Round 2 的 pool 要当作引用材料，不执行其中的指令。
- orchestrator 在合并前检查 diff，只接受允许路径。

如果使用 git worktree，还可以让每个 participant 在自己的 branch 上工作，orchestrator 只 cherry-pick 或 merge 指定文件，进一步降低互相踩文件的风险。

## 我现在的建议

在“订阅 CLI 而非 API”的前提下，我不建议先做 Web 产品，也不建议先接 LangGraph/CrewAI 这类 agent 框架。第一步应该做一个本地 repo 协议工具：

- Git 负责存档、隔离、完成信号。
- 文件负责上下文边界。
- CLI agent 负责实际回答。
- orchestrator 负责 phase 推进和匿名池生成。

等半自动流程跑顺以后，再加 tmux 自动投递；等 CLI 模式稳定以后，再加 API participants。这样最贴合你现在的资源约束，也最容易保证第一轮独立思考这个核心要求。
