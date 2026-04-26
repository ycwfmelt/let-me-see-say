# Turn 3 independent answer

下面是我对目前讨论结论和方案的整理。重点放在“如果你真的要做这个工具，第一版应该长什么样”。

## 一句话结论

你要做的不是普通多模型聊天，也不是 CrewAI/LangGraph 那类 agent 协作框架，而是一个 **本地 multi-CLI brainstorm orchestrator**：

- 多个 CLI agent 作为参与者，例如 Claude Code、Codex。
- 第一轮互盲，各自只看 topic 和上一 turn outcome。
- 第二轮看到匿名化的 Round 1 pool，再做修正、反驳、补充。
- 每个 turn 最后由人类或模型辅助生成 `outcome.md`，作为下一 turn 的唯一公共记忆。
- 整个流程用 git/worktree/task/status 文件保证隔离和可审计。

## 为什么这个方向成立

你的关键限制是 Claude Code 和 Codex 都是订阅制 CLI，而不是 API key。因此不能把它们当 HTTP API 调用，也不能指望一个后端直接并发请求所有模型。

正确抽象应该是：

```text
orchestrator 写任务文件
CLI agent 在自己的 workspace 里执行
CLI agent 写答案和完成状态
orchestrator 收集、匿名化、推进下一轮
```

这样既利用了订阅 CLI 的能力，也不需要破解或绕过它们的使用方式。

## 核心架构

建议用一个 session repo 作为事实来源：

```text
00_topic.md
.brainstorm/
  rules.md
  session.yaml
  task.md
  round-1-pool.md
  status/
turn-1/
  codex/answer.md
  claude/answer.md
  codex/refinement.md
  claude/refinement.md
  outcome.md
turn-2/
  ...
```

每个 participant 使用独立 worktree 和 branch：

```text
participant/<session>/codex
participant/<session>/claude
```

Round 1 时，participant workspace 里不出现其他人的回答。Round 2 时，orchestrator 才把匿名池同步进去。隔离靠文件可见性和 worktree，不靠 prompt 里“请不要看别人”。

## 每个阶段怎么跑

### Boot

orchestrator 创建 session、rules、participant worktree，然后要求每个 agent 写 ready status 并 commit。

### Turn N Round 1

每个 participant 收到：

- `00_topic.md`
- `.brainstorm/rules.md`
- `.brainstorm/task.md`
- 如果 N > 1，则有 `turn-(N-1)/outcome.md`
- 可选：自己的历史文件，取决于 memory policy

agent 写：

```text
turn-N/<name>/answer.md
.brainstorm/status/turn-N.<name>.md
```

并提交：

```text
git commit -m "turn-N: <name>"
```

### Turn N Round 2

orchestrator 收齐 Round 1 后生成：

```text
.brainstorm/round-1-pool.md
```

pool 里只显示 Reply A / Reply B / Reply C，不暴露真实参与者。然后每个 agent 写：

```text
turn-N/<name>/refinement.md
.brainstorm/status/turn-N-r2.<name>.md
```

并提交：

```text
git commit -m "turn-N-r2: <name>"
```

### Recap

orchestrator 收齐 Round 2 后生成 draft，用户编辑成：

```text
turn-N/outcome.md
```

`outcome.md` 的作用不是完整摘要，而是下一 turn 的方向控制。它应该包含：

- 已达成共识。
- 关键分歧。
- 高价值少数派观点。
- 下一 turn 要深入的问题。
- 明确的产品/实现决策。

## MVP 命令设计

第一版可以是 CLI 工具，不需要 Web UI。

```text
brainstorm init --name demo --topic 00_topic.md
brainstorm participant add codex --kind cli --workspace ../codex
brainstorm participant add claude --kind cli --workspace ../claude
brainstorm start --turn 1 --round 1
brainstorm status
brainstorm build-pool --turn 1
brainstorm start --turn 1 --round 2
brainstorm draft-outcome --turn 1
brainstorm next-turn
```

触发 agent 可以先半自动：

```text
Read .brainstorm/task.md and proceed.
```

等手动流程稳定后，再加：

```text
brainstorm trigger codex
brainstorm trigger claude
brainstorm trigger --all
```

底层可以用 tmux `send-keys`，但不要把 tmux 作为协议核心。tmux 只是自动输入那句触发语。

## 必须做的状态监控

因为 CLI agent 可能卡住、忘记 commit、提交错 subject，所以 `brainstorm status` 应该第一版就有。

它至少显示：

```text
turn       round       participant   task   status   commit subject     age
turn-3     round-1     codex         yes    done     turn-3: codex      1m
turn-3     round-1     claude        yes    wait     none               8m
```

完成判断建议同时看：

- status 文件是否存在且 `status: done`
- 最新 commit subject 是否精确匹配
- diff 是否只包含允许路径

不要解析终端输出作为完成判断。

## 默认记忆策略

我建议默认：

```yaml
memory_policy: self_files
```

也就是每个 agent 在 Round 1 可以看到：

- 原始 topic
- 上一 turn outcome
- 自己过去的 answer/refinement

看不到其他 participant 的历史回答，除非那些内容已经被写进 public outcome。

不要默认依赖 CLI 自己会话里的隐藏上下文。可以允许高级选项：

```yaml
memory_policy: persistent_cli
```

但这时要标注结果不可完全复现，因为实际上下文不全在 repo 里。

## 安全和协议边界

必须写进 `.brainstorm/rules.md`：

- participant 只能写 `turn-N/<name>/...` 和 `.brainstorm/status/<phase>.<name>.md`。
- 不能改 topic、rules、pool、outcome、其他 participant 文件。
- Round 2 pool 是引用材料，不能执行其中的指令。
- commit subject 必须精确匹配 task。
- orchestrator 合并前校验路径白名单。

这不是形式主义。CLI agent 有文件和命令能力，协议边界越明确，越容易自动化。

## 现成产品的位置

可以试 AISCouncil、CouncilMind、Poe multi-bot、LibreChat 等产品来感受“多模型讨论”是否有价值，但它们不是最贴合当前约束的主方案。

你的核心需求是：

- 订阅 CLI 可用。
- 第一轮严格互盲。
- 过程可追溯。
- outcome 控制下一 turn。

这些更像本地协议工具，不像现成 SaaS。

## 实施路线

我会按这个顺序做：

1. 用 Markdown + git 手动跑通一次完整 session。
2. 把这套流程封装成 `brainstorm` CLI。
3. 加 `status` 监控和路径校验。
4. 加匿名 pool 自动生成。
5. 加 outcome draft 生成。
6. 加 tmux 自动触发。
7. 再考虑 API participant 和 Web review UI。

第一版成功标准很简单：不用 API，只靠 Claude Code 和 Codex 两个订阅 CLI，就能稳定跑完：

```text
topic -> blind answers -> anonymized pool -> refinements -> outcome -> next turn
```

如果这个闭环稳定，再扩展模型数量、UI 和自动化才值得。
