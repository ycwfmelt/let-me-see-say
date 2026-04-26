# CLAUDE.md

设计和决策由 `docs/design.md`（架构活文档）和 `docs/decisions.md`（追加式决策日志）维护——开始任何工作前先读这两份。延期项见 `docs/TODO.md`。原始脑暴草稿在 `docs/drafts/`。

## 项目一句话

本地多模型脑暴 orchestrator：多个 participant（CLI agent；未来还有 human）在 tmux TUI 里就同一主题层层深入；每 turn 内分两 round（独立 + 收敛），turn 末尾产出 outcome 作为下一 turn 的种子。

## 在本仓库工作的硬约束

### Agent 调用方式

Agent 用长生 TUI session（`claude`、`codex` 不带 `-p` / `exec`），跨 turn 通过 `tmux send-keys` 投递触发；任务内容在 `.brainstorm/task.md`，send-keys 只说 "Read .brainstorm/task.md and proceed."。**不要**用 `claude -p` / `codex exec` 驱动 turn——agent 自己保留 context window 是设计前提。Done-signal 是 participant branch 上的 `git commit`（subject `<phase>: <name>`），不要靠 process-exit 或解析 pane 输出。详见 ADR-002 + ADR-005。

### 隔离不变量（不可破坏）

两条：

1. **Round 1 互盲**：参与者不能看到 siblings round-1 答卷。机制 = worktree-per-participant + 每个 participant 写专属路径 `turn-N/<self>/`。不要让多个 participant 写同一文件
2. **整 session 不做 mid-session merge**：跨 participant 的可见性由 orchestrator 文件投递控制（`git -C <wt> add && commit` 到对应分支），**不**通过 git merge 跨分支传播。Session 结束 `brainstorm finalize` 时才一次性 merge 归档。详见 ADR-003

### MVP 范围（严格控制）

当前 MVP：

- 2 agent profile（`claude-sonnet` + `codex`），1 session，2 turn
- 文件协议（**不**做 MCP——MCP 是文件协议跑顺后的机械重构）
- `--vault` flag（**不**做 `brainstorm init` 全局配置）
- Filesystem-only（**不**做 SQLite）
- 只实现 TUIAgent（**不**做 Human，留 stub）
- **不**做 role 注入（协议槽位留好）

验证三件事：tmux send-keys + task.md 读取链路稳 / git commit 作交卷信号可检测 / outcome 跨 turn 衔接有效。

### MVP 边界（不做但协议留槽位）

下面这些 MVP 不做，但协议层接口已经留好——**未来要做时不要改协议**，直接接进现有结构。详见 `docs/TODO.md`。

- **Human participant**：协议层完整支持（branch / 文件结构 / task.md / status 都对 human 适用）；实现层只 stub。Web UI 来时实现 Human 类
- **Role / 角色化 prompt**：`Participant.role` 字段 + prompt 模板的 `{{role_section}}` 槽位都已经留好
- **SQLite 元数据 / MCP / 多 artifact 形态**：协议都不假设这些不存在

### 设计决策怎么记

非平凡设计决策（或反转旧决策）→ 追加 ADR 到 `docs/decisions.md`。**不要修改旧 ADR**；推翻就把旧条目状态改成 `Superseded by ADR-NNN`、写新条目。`docs/design.md` 是活文档，反映当前状态；ADR 是历史。

### Obsidian

Vault 是 main 分支的 worktree——人类阅读端，**不是** agent 的共享工作区。Agent 写 markdown 直接写盘，不调 Obsidian CLI；Obsidian CLI 留给 orchestrator 维护 vault 级别的 index/MOC。`.obsidian/workspace.json` 等 workspace state 必须 `.gitignore`。
