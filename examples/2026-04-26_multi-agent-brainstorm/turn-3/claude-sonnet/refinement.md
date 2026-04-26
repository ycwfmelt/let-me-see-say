# Turn 3 · Round 2 — claude-sonnet refinement

## 整体判断

两个摘要的核心内容高度一致，这说明前两个 turn 的讨论已经真正收敛出了共同结论。分歧主要在表述角度：Reply A 更侧重"第一版应该怎么做"（实施路线、命令集、成功标准），Reply B 更侧重"架构是什么"（状态机、结论编号）。两者互补，合并后是更完整的总结。

---

## 我修改的一个重要措辞

**Reply A 说"不要把 tmux 作为协议核心"——这个表述比我 Round 1 的表述更准确，我接受。**

我 Round 1 说"tmux + git 是唯一路线"，容易让人误解 tmux 本身是不可替代的。正确理解是：

- **协议核心**：文件 + git（task.md / status file / git commit / worktree）
- **Transport 层**：tmux send-keys（目前的实现方式）

协议核心是稳定的；transport 层是可替换的（将来可能是别的 IPC 方式，但不影响协议）。这个分层很重要，因为它决定了什么是"硬约束"，什么是"实现细节"。

---

## 我采纳的内容

**1. CLI 命令集（Reply A 更完整）**

Reply A 的命令集比我更具体，特别是 `brainstorm trigger` 这个设计：

```
brainstorm trigger codex
brainstorm trigger claude
brainstorm trigger --all
```

这把 tmux 封装进了 brainstorm CLI，用户只操作 `brainstorm` 命令，不直接调 `tmux send-keys`。这是正确的抽象层次——tmux 是 transport 实现细节，不应暴露给用户。

**2. 实施路线（Reply A 更务实）**

```
1. 手动跑通一次完整 session（验证协议）
2. 封装成 brainstorm CLI
3. 加 status 监控和路径校验
4. 加匿名 pool 自动生成
5. 加 outcome draft 生成
6. 加 tmux 自动触发（brainstorm trigger）
7. 再考虑 API participant 和 Web UI
```

先手动验证协议、再工程化，这避免了"在错误的协议上构建工具"的风险。

**3. 成功标准（Reply A 的贡献）**

> 不用 API，只靠 Claude Code 和 Codex 两个订阅 CLI，就能稳定跑完：
> `topic → blind answers → anonymized pool → refinements → outcome → next turn`

这个成功标准很具体，可以直接作为 MVP 的 acceptance criteria。

---

## 我补充 / 坚持的内容

**orchestrator-state.json（Reply A 没有强调，但我认为是 P0）**

Reply A 的实施路线里没有明确状态持久化，但这个东西第一版就该有。原因：

- 没有持久化状态，orchestrator 每次启动都要靠 git log 重建当前 phase，逻辑复杂
- 有了 JSON 状态文件，`brainstorm status` 的实现就是读一个文件，而不是解析 git log
- 崩溃恢复从"人工判断现在到哪步了"变成"读 state.json 继续"

最小 schema：
```json
{
  "session_id": "...",
  "current_phase": "turn-3-r2",
  "participants_expected": ["codex", "claude-sonnet"],
  "participants_done": ["codex"],
  "next_action": "await_claude-sonnet"
}
```

**未解决的问题（Reply A 没有列，但对用户有价值）**

两个摘要都没有深入讨论这些，值得在后续 turn 或实现阶段解决：

1. **Orchestrator 语言**：Shell 脚本对于文件操作 + git + tmux 已经够了，但 state.json + git log 解析 + 多 participant 协调用 Python 会更健壮。建议：Python 脚本 + subprocess，不引入额外框架。

2. **Agent 挂起的处理**：timeout（wall-clock）多长？建议可配置，默认 10 分钟。超时后 `brainstorm status` 显示 `TIMEOUT`，需要人工 `brainstorm retry <name>` 重新触发。

3. **tmux send-keys 可靠性**：在 agent 还在处理上一个 task 时 send-keys 会干扰。建议触发前先检查 status 文件是否存在（如果存在说明上一 phase 已完成），再 send-keys。

4. **Outcome 质量**：防止 turn 之间原地打转，outcome.md 格式应强制包含"下一 turn 要追问的具体问题"，而不只是"本 turn 结论"。

---

## 最终合并总结

| 层次 | 内容 |
|---|---|
| **What** | 本地 multi-CLI brainstorm orchestrator，blind Round 1 + anonymized Round 2 + human-curated outcome |
| **Why** | 订阅 CLI（非 API）约束决定架构；脑暴价值在于受控信息流 + 少数派保留 |
| **Protocol core** | 文件 + git（task.md / status / worktree / commit subject） |
| **Transport** | tmux send-keys（可替换，不是协议核心） |
| **State** | orchestrator-state.json（可持久化，支持崩溃恢复） |
| **Memory** | 默认 `self`（agent 看自己历史但不看他人 Round 1） |
| **First success** | 两个订阅 CLI 稳定跑完完整 session 闭环，无 API |
| **Build order** | 手动验证 → brainstorm CLI → status 监控 → trigger 自动化 → API participant → Web UI |
