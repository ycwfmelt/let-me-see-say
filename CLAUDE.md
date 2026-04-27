# CLAUDE.md

设计和决策由 `docs/design.md`（架构活文档）和 `docs/decisions.md`（追加式决策日志）维护——开始任何工作前先读这两份。延期项见 `docs/TODO.md`。原始脑暴草稿在 `docs/drafts/`。

## 项目一句话

本地多模型脑暴 orchestrator：多个 participant（CLI agent；未来还有 human）在 tmux TUI 里就同一主题层层深入；每 turn 内分两 round（独立 + 收敛），turn 末尾产出 outcome 作为下一 turn 的种子。Web UI 提供 session 管理、实时 pane 查看、outcome 编辑。

## 技术栈

- **Runtime / Package manager**: Bun
- **Framework**: Next.js (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Testing**: Vitest (`bun test`)
- **No CLI**: 所有交互通过 Web UI（`bun dev` 启动）

## 目录结构

- `src/lib/` — 核心逻辑（orchestrator、git-ops、tmux-ops、participant、prompts）
- `src/app/` — Next.js App Router 页面和 API routes
- `src/components/` — React 组件
- `src/hooks/` — React hooks（SSE、session fetching）
- `__tests__/` — Vitest 测试
- `docs/` — 设计文档
- `examples/` — 归档的示例 session

## 在本仓库工作的硬约束

### Agent 调用方式

Agent 用长生 TUI session（`claude`、`codex` 不带 `-p` / `exec`），跨 turn 通过 `tmux send-keys` 投递触发；任务内容在 `.brainstorm/task.md`，send-keys 只说 "Read .brainstorm/task.md and proceed."。**不要**用 `claude -p` / `codex exec` 驱动 turn——agent 自己保留 context window 是设计前提。Done-signal 是 participant branch 上的 `git commit`（subject `<phase>: <name>`），不要靠 process-exit 或解析 pane 输出。详见 ADR-002 + ADR-005。

### 隔离不变量（不可破坏）

两条：

1. **Round 1 互盲**：参与者不能看到 siblings round-1 答卷。机制 = worktree-per-participant + 每个 participant 写专属路径 `turn-N/<self>/`。不要让多个 participant 写同一文件
2. **整 session 不做 mid-session merge**：跨 participant 的可见性由 orchestrator 文件投递控制（`git -C <wt> add && commit` 到对应分支），**不**通过 git merge 跨分支传播。Session finalize 时才一次性 merge 归档。详见 ADR-003

### 设计决策怎么记

非平凡设计决策（或反转旧决策）→ 追加 ADR 到 `docs/decisions.md`。**不要修改旧 ADR**；推翻就把旧条目状态改成 `Superseded by ADR-NNN`、写新条目。`docs/design.md` 是活文档，反映当前状态；ADR 是历史。

### Obsidian

Vault 是 main 分支的 worktree——人类阅读端，**不是** agent 的共享工作区。Agent 写 markdown 直接写盘，不调 Obsidian CLI；Obsidian CLI 留给 orchestrator 维护 vault 级别的 index/MOC。`.obsidian/workspace.json` 等 workspace state 必须 `.gitignore`。

### 用户配置 vs 模板

`agents.toml` 是用户本地 profile（可能含 token / API key 等），**已 gitignored**。仓库里 commit 的是 `agents.toml.example` 模板。修改用户 profile 不会污染 git 历史；新人 clone 后 `cp agents.toml.example agents.toml` 起手。如果有引入新的用户 / 机器特定配置，沿用同一模式（`*.example` 进 git，实际文件 gitignored）。
