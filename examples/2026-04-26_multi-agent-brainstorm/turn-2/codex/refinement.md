# Turn 2 Round 2 refinement

看完 Reply A 和 Reply B 后，我会把结论进一步收紧：

**在 Claude Code / Codex 都是订阅 CLI 的前提下，第一版就应该按“本地 CLI 编排器”设计。API 模型可以兼容，但不能作为主路径。**

我仍然保留一个细微修正：不一定一开始就必须 tmux 自动化。真正必须的是 **worktree 隔离 + task.md 协议 + git/status 完成信号**。tmux 是让体验更顺的触发层，不是协议本身。

## 我采纳 Reply B 的部分

Reply B 把订阅 CLI 和 API 调用的差异说清楚了：CLI agent 不能像 HTTP API 那样被程序精确控制，完成检测、超时、错误处理都要外置。因此 done signal 不能依赖终端输出，应该依赖 git commit subject 或 status file。

我同意这些点：

- `task.md` 是正确的任务投递方式。orchestrator 只发送一句 “Read .brainstorm/task.md and proceed.”，避免复杂 prompt 通过终端输入时出错。
- `git commit` 是更可靠的完成信号。commit subject 必须严格匹配，orchestrator 才能无歧义推进。
- 每个 participant 一个 worktree/branch 是必要的。Round 1 互盲最好是物理隔离，不靠模型自觉。
- human 应该自然位于 recap 阶段。`outcome.md` 不是普通摘要，而是人类对下一 turn 方向的控制点。
- MVP 需要状态监控，否则 agent 卡住、commit subject 错误、tmux pane 关闭时很难排查。

## 我会调整的地方

Reply B 说 tmux + git 是“唯一路线”。我会改成：

**git/worktree/task 协议是唯一路线，tmux 是推荐自动化路线。**

原因是第一版如果直接绑定 tmux，可能会把复杂度放错地方。你真正要验证的是 blind-round protocol，而不是终端自动化稳定性。更稳的路径是：

1. 先支持手动触发：用户在每个 CLI 里输入固定触发语。
2. 完成信号仍由 git/status 文件判断。
3. 手动流程稳定后，再加 tmux send-keys。

这样即使 tmux 自动化暂时不稳定，协议也能继续跑。

## 更具体的 MVP 设计

我会把 orchestrator 做成一个本地 CLI 工具，先不做 Web UI。

### Session 初始化

```text
brainstorm init --name demo --topic 00_topic.md
brainstorm participant add codex --kind cli --workspace ../participants/codex
brainstorm participant add claude --kind cli --workspace ../participants/claude
```

初始化时创建：

- 一个 orchestrator repo/worktree，保存 session 真相。
- 每个 participant 一个 worktree，分支名类似 `participant/<session>/<name>`。
- `.brainstorm/rules.md`，写死路径权限、commit subject、每轮流程。
- `.brainstorm/session.yaml`，记录 participants、workspace、触发方式、memory policy。

### Phase 推进

每个 phase 由 orchestrator 写任务：

```text
brainstorm start turn-2 round-1
```

它会给每个 participant workspace 写：

- `00_topic.md`
- `.brainstorm/rules.md`
- `.brainstorm/task.md`
- 上一 turn 的 `outcome.md`
- 允许的自身历史文件

Round 1 不同步其他 participant 的 answer。Round 2 才同步匿名 pool。

### 完成检测

orchestrator 可以同时检查两个信号：

- `.brainstorm/status/<phase>.<name>.md` 存在且 status 为 done。
- participant 分支最新提交 subject 等于 task 要求的 subject。

两个都检查更好：status file 适合机器读，git commit 适合审计和跨 worktree 传输。缺一不可时，MVP 可以先要求 commit，因为它天然带 diff。

### 收集输出

Round 1 收齐后：

1. orchestrator 从每个 participant branch 读取 `turn-N/<name>/answer.md`。
2. 校验 diff 只包含允许路径。
3. 复制或 merge 到 orchestrator 视图。
4. 生成 `.brainstorm/round-1-pool.md`，把真实 participant 映射存在 orchestrator-only metadata 里。

Round 2 同理，只是输出变成 `turn-N/<name>/refinement.md`。

## 状态监控面板应该第一版就有

这里我比上一轮更强调 monitor。因为 CLI agent 的失败模式不是 HTTP 500，而是“它可能正在想、可能卡在权限确认、可能忘了 commit、可能提交错 subject”。所以 MVP 至少要有：

```text
brainstorm status
```

输出类似：

```text
turn-2 round-1

participant      workspace        task written   status file   commit subject      age
codex            .../codex        yes            done          turn-2: codex       2m
claude           .../claude       yes            waiting       none                9m
```

如果用 tmux，再加：

```text
brainstorm panes
brainstorm trigger codex
brainstorm trigger --all
```

但不要依赖解析 pane 内容来判断完成。

## 记忆策略的最终建议

对订阅 CLI 来说，隐藏上下文是双刃剑。它让 agent 更像持续参与者，但也让实验不可复现。

我会把默认设为：

```yaml
memory_policy: self_files
```

意思是 participant 可以看到：

- 原始 topic。
- 上一 turn outcome。
- 自己过去的 answer/refinement。

但不依赖 CLI 自己的会话记忆。用户如果愿意，可以开：

```yaml
memory_policy: persistent_cli
```

这时 UI/状态里必须标注这一轮“不可完全复现”，因为 agent 可能使用了没有落盘的会话上下文。

## 最小实现优先级

我现在会按这个顺序做：

1. Repo/worktree/session 初始化。
2. Phase task 生成。
3. 手动触发协议。
4. commit/status 完成检测。
5. Round 1 pool 匿名化。
6. Round 2 task 生成。
7. outcome 人工编辑与下一 turn 启动。
8. `brainstorm status` 监控。
9. tmux 自动触发。
10. API participant adapter。

这个顺序的原因是：前 7 步就能验证核心脑暴流程；第 8 步让真实使用不痛苦；第 9 步提升效率；第 10 步只是扩展 participant 类型。

## 更新后的结论

这件事现在不应该优先找 SaaS 产品，也不应该优先接多 agent 框架。你的资源约束已经把方向推向了一个本地 protocol tool：

- participant 是订阅 CLI agent。
- 隔离靠 worktree 和文件可见性。
- 协作靠 `task.md`。
- 完成靠 status file + git commit。
- 收敛靠匿名 pool 和人工可编辑 outcome。

只要这个协议做稳，后面无论是加 tmux、加 API 模型、加 Web review UI，都是增量能力，不会动摇第一轮互盲和 turn recap 这两个核心设计。
