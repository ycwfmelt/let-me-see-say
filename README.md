# let-me-see-say

> 状态：design 完成，MVP 起手中。

本地多模型脑暴 orchestrator。多个 participant（CLI agent，未来还有 human）就一个主题在多个 turn 里层层深入；每 turn 内分两 round（独立 + 收敛），turn 末尾产出 outcome 作为下一 turn 的种子。

## 这是干什么的

你想脑暴一个主题（"多模型脑暴系统怎么设计"、"这个 UX 流程要怎么改"），但身边没合适的人。这个工具开 session，让多个 LLM agent（claude-sonnet、claude-opus、codex 等）独立给观点 → 互相 anonymized 看到对方再收敛 → 每轮你确认 outcome 进下一轮深入。Obsidian 当答题纸 + 历史归档。

整个过程**只用订阅 CLI**（claude / codex），不烧 API token；agent 的对话上下文由 TUI 自身保留，跨 turn 不丢。

## 文档

- [docs/design.md](docs/design.md) · 当前架构活文档
- [docs/decisions.md](docs/decisions.md) · ADR 决策日志
- [docs/TODO.md](docs/TODO.md) · 延期项
- [docs/drafts/](docs/drafts/) · 历史脑暴草稿
- [CLAUDE.md](CLAUDE.md) · 在本仓库工作的硬约束

## 用法

项目用 [uv](https://docs.astral.sh/uv/) 管理依赖。

```bash
# 同步依赖到 .venv（会读 pyproject.toml + uv.lock）
uv sync

# 跑 CLI（uv run 自动用项目 venv，无需 activate）
uv run brainstorm --help
```

MVP 实施中，命令目前为 stub：

```bash
# 开新 session
uv run brainstorm new "multi-agent brainstorm system design" \
    --vault ~/Obsidian \
    --with claude-sonnet,codex

# 看完 outcome 后推进到下一 turn
uv run brainstorm next <session-id>

# 查看 session 状态
uv run brainstorm status [session-id]

# 取消 session（停 TUI、归档）
uv run brainstorm cancel <session-id>

# 结束 session（merge + final synthesis）
uv run brainstorm finalize <session-id>
```

Agent profiles 在 `agents.toml`——同一个 CLI 不同 model 是不同 participant（`claude-sonnet` / `claude-opus`）。

## 状态

MVP 范围严格控制（详见 CLAUDE.md "MVP 范围"）：2 agent、2 turn、文件协议、filesystem-only、`--vault` flag、不做 human / role / SQLite / MCP（协议层都已留槽位）。

## License

TBD
