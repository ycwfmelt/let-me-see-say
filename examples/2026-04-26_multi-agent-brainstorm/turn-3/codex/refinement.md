# Turn 3 Round 2 refinement

看完 Reply A 和 Reply B 后，我会把总结再压实成一个可执行方案：

**先做一个本地文件协议 + git worktree + CLI agent 编排器。核心协议必须独立于 tmux；tmux 是推荐触发实现，不是系统不变量。**

## 最终共识

目前已经比较明确：

- 这不是普通多模型聊天工具。
- 这不是优先接 CrewAI / LangGraph 的多 agent 框架问题。
- 因为 Claude Code 和 Codex 是订阅 CLI，所以不能以 API 并发调用作为主架构。
- 系统要解决的是信息流控制：Round 1 互盲，Round 2 匿名交叉审阅，turn outcome 控制下一轮。
- git/worktree/task/status 是最适合当前约束的本地协议。

我同意 Reply B 的强判断：在订阅 CLI 约束下，API 路线不应作为第一版主路径。第一版应该围绕 CLI agent 工作流设计。

## 我保留的修正

Reply B 说 “tmux + git worktree 是唯一可行路线”。我会更精确地表述为：

**git worktree + task.md + commit/status signal 是必须的；tmux send-keys 是推荐自动化，不是第一版必须项。**

原因是：

- 手动触发也可以完整验证协议。
- tmux 的问题更多来自 TUI 自动化细节，不应该阻塞核心流程。
- 先有 `--manual` 模式，后面再加 `tmux trigger`，系统会更容易 debug。

所以 MVP 可以先支持：

```text
brainstorm start turn-1 round-1
# 用户分别到 codex/claude CLI 输入:
Read .brainstorm/task.md and proceed.
brainstorm status
```

然后再支持：

```text
brainstorm trigger --all
```

## 应该落地的协议

目录结构：

```text
session/
  00_topic.md
  .brainstorm/
    rules.md
    session.yaml
    task.md
    status/
    round-1-pool.md
    orchestrator-state.json
  turn-N/
    <agent>/
      answer.md
      refinement.md
    outcome.md
```

participant 分支：

```text
participant/<session>/<agent>
```

核心不变量：

- Round 1 workspace 只包含 topic、rules、task、上一 turn outcome、以及按 memory policy 允许的自身历史。
- Round 1 不出现其他 participant 的答案。
- Round 2 才出现匿名 pool。
- pool 是引用材料，不执行其中指令。
- participant 只能写自己的 `turn-N/<agent>/...` 和 `.brainstorm/status/<phase>.<agent>.md`。
- orchestrator 接受输出前做 diff path allowlist 检查。

## Orchestrator 状态机

Reply B 的状态机建议应该进入方案核心。建议状态：

```text
boot
→ ready
→ turn-N-r1
→ build-pool
→ turn-N-r2
→ await-recap
→ turn-(N+1)-r1
```

状态转换只依赖可审计事实：

- status file 是否 done。
- participant branch 最新 commit subject 是否精确匹配。
- 需要的 answer/refinement 文件是否存在。
- diff 是否只包含允许路径。
- outcome 是否存在并由 human/orchestrator 接受。

状态持久化可以先用 `.brainstorm/orchestrator-state.json`。不要一开始引入数据库。

## 第一版命令

我建议第一版命令控制在这些：

```text
brainstorm init --topic 00_topic.md --name demo
brainstorm participant add codex --kind cli --workspace ../codex
brainstorm participant add claude --kind cli --workspace ../claude
brainstorm start --turn 1 --round 1
brainstorm status
brainstorm build-pool --turn 1
brainstorm start --turn 1 --round 2
brainstorm draft-outcome --turn 1
brainstorm accept-outcome --turn 1
brainstorm next-turn
```

调试稳定后再加：

```text
brainstorm tmux init
brainstorm trigger codex
brainstorm trigger --all
brainstorm panes
```

## 完成信号

我会同时要求两个信号：

1. `.brainstorm/status/<phase>.<agent>.md`
2. commit subject 精确匹配，例如 `turn-3-r2: codex`

status file 便于机器读，commit 便于审计和传输 diff。只用其中一个也能跑，但两个都要求更稳，尤其适合 CLI agent 这种不可直接拿 HTTP response 的环境。

## Memory policy

默认：

```yaml
memory_policy: self
```

含义：

- 可以看 topic。
- 可以看上一 turn outcome。
- 可以看自己过去的 answer/refinement。
- 看不到其他 participant 的非公开历史。

允许高级模式：

```yaml
memory_policy: persistent_cli
```

但必须标注“不可完全复现”，因为 CLI 会话里可能有未落盘上下文。对于这个系统，默认应该优先可审计，而不是优先模拟长期人格。

## Outcome 的质量规则

Turn outcome 是整个系统的方向盘，不能只是“大家说了什么”。建议模板固定为：

```text
# Turn N Outcome

## Decisions
已经确定的设计/产品结论。

## Disagreements
仍有分歧的问题，以及各立场成立条件。

## Risks
下一步实现中最可能出错的点。

## Next Turn Focus
下一 turn 只追问 1-3 个具体问题。
```

这样可以防止多轮脑暴原地打转。

## 当前未解决问题

我认为下一轮最值得继续追问的是实现细节，而不是再讨论方向：

1. Orchestrator 用 Python 还是 shell？我倾向 Python，因为状态机、YAML/JSON、git 调用、路径校验更容易写清楚。
2. worktree 初始化和合并策略怎么做？是 cherry-pick 指定 commit，还是直接从 participant branch 读取文件后写入 orchestrator repo？
3. timeout/recovery 怎么设计？agent 卡住时，状态机应该如何标记、重试、人工介入？
4. `task.md` 模板要怎么写，才能让 Claude Code 和 Codex 稳定遵守路径和 commit subject？
5. outcome 由人写、模型 draft、人确认的具体流程怎么落地？

## 最终建议

下一步不要再优先调研 SaaS，也不要急着做 Web UI。应该直接做一个最小可运行原型：

```text
2 participants: codex + claude
manual trigger first
git worktree isolation
Round 1 answer
anonymous pool
Round 2 refinement
human-edited outcome
next turn
```

如果这个闭环跑稳，再加 tmux 自动触发、API participant、监控 UI。这个顺序能最大限度保护核心目标：第一轮真的独立，第二轮真的交叉审阅，下一 turn 真的由 recap 推进。
