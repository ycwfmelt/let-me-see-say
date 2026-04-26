# let-me-see-say · 设计文档

> 状态：MVP 实施起手。
> 最近更新：2026-04-25

本地多模型脑暴 orchestrator。多个参与者（CLI agent；未来还有 human）就一个主题在多个 turn 里层层深入；每 turn 内分两个 round（独立 + 收敛），turn 末尾产出 outcome 作为下一 turn 的种子。

本文档是当前架构的活文档（current state）。决策的来龙去脉看 `decisions.md`。延期项在 `TODO.md`。原始脑暴草稿在 `drafts/`。

## 目标
- 利用订阅制 CLI（无 API 计费）
- Round 1 真正盲答；round 2 看到 anonymized 池后再收敛
- Turn outcome 作为 deepening 种子（不是答卷综合）
- Human-in-the-loop：人推进 turn 边界 + 编辑确认 outcome
- 协议层不假设 participant 类型（agent / human）和 model 组合（同一个 CLI 不同 model 是不同 participant）
- Local-only

## 非目标（MVP 阶段）
- Web UI（设计为它留接口，实现延后）
- Human participant 的 CLI / 通知 / 提交流（协议层支持，实现等 web UI）
- SQLite 元数据（filesystem 扫目录够用）
- Role 卡 / 角色化 prompt（协议槽位留好；详见 `TODO.md`）
- 自动循环（人按 `next` 推进）
- MCP server（先文件协议跑通；MCP 是后续机械重构）

## 核心抽象

### Participant

任何参与者都是一个 participant：

- **Name**：唯一身份（branch / 路径 / 状态文件名都用它）
- **Worktree**：每个 participant 独立 git worktree
- **Branch**：`participant/<session>/<name>`
- **Wake**：orchestrator 通知"该你了"（agent 用 tmux send-keys；human 未来用 web UI）
- **Done signal**：在自己分支上 git commit，subject 含 `<phase>: <name>`

MVP 阶段实现 `TUIAgent` 一种 participant；`Human` 留 stub。

### Agent profile

Agent 通过 `agents.toml` 注册。Profile 名 = participant name。同 CLI 不同 model 是不同 profile：

```toml
[agents.claude-sonnet]
cli = "claude"
flags = ["--model", "sonnet"]

[agents.claude-opus]
cli = "claude"
flags = ["--model", "opus"]

[agents.codex]
cli = "codex"
flags = []

[agents.claude-with-custom-token]
cli = "claude"
env = { ANTHROPIC_OAUTH_TOKEN = "..." }
```

Orchestrator 启动 TUI 时把 `env` 注入子进程并执行 `cli + flags`（效果类似 `KEY=val claude --model sonnet`）。Branch / 路径都用 profile 名，协议层不知道 cli / model 是啥。

### Turn 形状

```
turn N:
  ├─ Phase 0/sync   (turn 1 是 boot；后续 turn 是把 turn N-1 的 outcome 投递给 participants)
  ├─ Round 1        (独立答题，互盲)
  ├─ Round 2        (看 anonymized round-1 池，收敛)
  └─ Outcome        (orchestrator LLM 起草 + 人编辑确认)
                       └─ 作为 turn N+1 的种子
```

**Outcome ≠ recap**：不是"把大家说的总结一下"，是"决定 / 厘清 / 列开放议题——下一轮在这上面展开"。文件 `outcome.md` 的 frontmatter `kind: decision | open-questions | summary` 区分形态。早期 turn 常常不收敛（kind = open-questions），中后 turn 逐步收敛到 decision。

### Task delivery：`.brainstorm/task.md`

每个 participant worktree 里 `.brainstorm/task.md` 是当前任务的 canonical 载体。orchestrator 每开新 phase：

1. 写 `.brainstorm/task.md`（这一轮要干啥）
2. Commit 到该 participant 分支：`task: <phase>: <name>`
3. 唤醒该 participant：
   - **TUIAgent**：`tmux send-keys "Read .brainstorm/task.md and proceed." Enter`
   - **Human (future)**：web UI 监测 task.md 变化 → 给人展示

Send-keys 只是 wake signal，内容在文件——避免 tmux 转义 / 引号 / 长度问题，且任意 participant 类型都用同一接口。

## 关键设计选择

详见 `decisions.md`。要点：
- **CLI agent 长生 TUI**（ADR-002）：跨 turn 保留 context，orchestrator 不重建历史
- **整 session 不做 mid-session merge**（ADR-003）：跨 participant 可见性由 orchestrator 文件投递控制
- **Turn = 深入；outcome 替 recap**（ADR-004）：turn 间传递的是"下一步要做什么"
- **Participant 抽象 + task.md 唤醒协议**（ADR-005）：agent + human 协议层等价

## 仓库 / vault 布局

仓库：

```
let-me-see-say/
├── docs/
│   ├── design.md             # 本文档
│   ├── decisions.md          # ADR 日志
│   ├── TODO.md               # 延期项
│   └── drafts/
├── brainstormd/              # orchestrator (Python)
│   ├── __init__.py
│   ├── __main__.py
│   ├── cli.py                # typer-based CLI（已有 stub）
│   ├── orchestrator.py       # state machine (TBD)
│   ├── participant.py        # Participant interface + TUIAgent + Human stub (TBD)
│   ├── git_ops.py            # worktree / commit / poll (TBD)
│   ├── tmux_ops.py           # tmux wrapper (TBD)
│   └── prompts.py            # task.md 模板 (TBD)
├── agents.toml               # agent profiles
├── pyproject.toml
├── README.md
├── CLAUDE.md
└── private-workspaces/       # gitignored；每 session/participant 一个 worktree
    └── <session>/
        ├── claude-sonnet/
        └── codex/
```

Vault session 目录（orchestrator 在 vault 里创建）：

```
<vault>/Brainstorm/sessions/<session_id>/   # main branch checkout
├── .git/
├── .brainstorm/
│   └── rules.md              # 一次性写在 main，所有分支继承
├── 00_topic.md
├── next.md                   # 人写下一 turn 输入（可选）
├── turn-1/
│   └── outcome.md            # orchestrator 起草，人编辑确认；commit 到 main
└── turn-2/...
```

每 participant 的 worktree（`let-me-see-say/private-workspaces/<session>/<name>/`）：

```
<worktree>/                   # branch participant/<session>/<name>
├── .brainstorm/
│   ├── rules.md              # 继承自 main
│   ├── task.md               # orchestrator 每 phase 写 + commit
│   ├── round-1-pool.md       # round-2 前 orchestrator 写：anonymized round-1 池
│   └── status/
│       ├── ready.<name>.md
│       ├── turn-1.<name>.md
│       └── turn-2.<name>.md
├── 00_topic.md
├── turn-1/
│   ├── <name>/               # 该 participant 的答题目录（其它 participant 看不到）
│   │   ├── answer.md         # round-1 答卷
│   │   └── refinement.md     # round-2 refinement
│   └── outcome.md            # 上一 turn 完成、人确认后 orchestrator 投递
└── turn-2/<name>/
```

**关键不变量**：每个 participant 只看到自己的 `turn-N/<name>/`，看不到 siblings 的目录——因为不做 mid-session merge，orchestrator 投递的只有 round-1-pool（匿名）和 outcome（已确认），不投递 raw 答卷。

Session finalize 时（一次性 merge）vault main 上才能看到所有人的答卷。

## 单 turn 详细流程

### Phase 0 · Setup（turn 1 一次性）

1. 人执行 `brainstorm new "topic" --vault <path> --with claude-sonnet,codex`
2. Orchestrator：算 `session_id` → `mkdir + git init` vault session 目录 → 写 `00_topic.md`、`.brainstorm/rules.md` → main 上 commit
3. 对每个 participant：
   - `git worktree add <wt-path> -b participant/<session>/<name>`（vault session repo 的 worktree）
   - 启动 TUI：`tmux new -d -s brainstorm-<session>-<name> -c <wt>`
   - send-keys 启动 agent：`tmux send-keys "<cli> <flags>" Enter`（env 通过 tmux env 或 `set-environment` 注入）
   - 等几秒等 TUI ready

### Phase 1 · Boot handshake（turn 1 一次性）

4. 对每个 participant：
   - 写 `.brainstorm/task.md`（boot 任务："Read rules.md, write ready file, commit"）
   - `git -C <wt> add .brainstorm/task.md && git -C <wt> commit -m "task: boot: <name>"`
5. send-keys 唤醒：`tmux send-keys "Read .brainstorm/task.md and proceed." Enter`
6. Participant 内部：读 task.md → 读 rules.md → 写 `.brainstorm/status/ready.<name>.md` → commit `ready: <name>`
7. orchestrator polls 每 ~2s：`git -C <wt> log -1 --format=%s participant/<session>/<X>`，匹配 `^ready: <X>$`
8. 全员就绪 → Phase 2

### Phase 2 · Round 1

9. 对每个 participant：写 task.md（round-1 任务："读 00_topic.md，独立写答卷到 turn-1/<name>/answer.md，commit"）+ commit + send-keys 触发
10. Participant：读 task.md → 读 00_topic.md → 写 `turn-1/<name>/answer.md` → 写 status → commit `turn-1: <name>`
11. orchestrator polls，全员交卷 → Phase 3

### Phase 3 · Round 2（orchestrator 跨 worktree 投递匿名池）

12. orchestrator 从每 participant 分支读 round-1 答卷（**不 merge**）：`git -C <vault-session> show participant/<session>/<X>:turn-1/<X>/answer.md`
13. orchestrator 调 LLM 生成 anonymized round-1 池，含 frontmatter 里的 anonymization map（reply A → claude-sonnet 等，仅 orchestrator 用）
14. 把池**复制到每个 participant worktree** 的 `.brainstorm/round-1-pool.md` + commit 到对应分支：`pool delivered: <name>`
15. 对每个 participant：写 task.md（round-2 任务："读 .brainstorm/round-1-pool.md，refine 你的观点，写到 turn-1/<name>/refinement.md，commit"）+ commit + send-keys
16. Participant：读 → 写 → commit `turn-1-r2: <name>`
17. orchestrator polls，全员收敛 → Phase 4

### Phase 4 · Outcome 起草 + 人编辑确认

18. orchestrator 从每 participant 分支读 round-2 refinement（不 merge）
19. orchestrator 调 LLM 起草 `turn-1/outcome.md`（frontmatter 含 `kind` / `anonymization` / 内容是 turn 的"决定 / 厘清 / 开放议题"）
20. 写到 vault main worktree + commit 到 main
21. 通知人：CLI 输出 "Outcome 起草已写到 `<vault>/.../turn-1/outcome.md`，编辑确认后跑 `brainstorm next <session>`"
22. 人在 Obsidian 编辑 outcome.md，commit 到 main（手动或下一步自动 amend）

### Phase 5 · 衔接下一 turn 或 finalize（人触发）

**`brainstorm next <session>`**：
23. orchestrator 读 vault main 的 `turn-N/outcome.md`（人确认版）
24. 复制到每个 participant worktree 的 `turn-N/outcome.md` + commit 到对应分支：`outcome delivered: <name>`
25. 进入 turn N+1 的 Phase 1.5（sync + 新一轮 task.md："Turn N+1 开始。Read turn-N/outcome.md（上轮已确认产出），基于它深入..."），跳到 Phase 2

**`brainstorm finalize <session>`**：
26. orchestrator 在 vault main 上 octopus / 顺序 merge 所有 participant 分支——**整 session 唯一的跨分支 merge**
27. 写 `final-synthesis.md`
28. 关 tmux session、worktree 清理（可选保留）

## MVP 范围（严格控制）

- 2 个 agent profile：`claude-sonnet` + `codex`
- 1 session、2 turn
- 文件协议（无 MCP）
- `--vault` flag（无 `brainstorm init` 全局配置）
- Filesystem-only（无 SQLite）
- 只实现 TUIAgent（无 Human，留 stub）
- 无 role 注入（协议槽位留好）

要验证三件事：
1. tmux send-keys + task.md 读取链路稳
2. git commit 作交卷信号可检测
3. outcome 跨 turn 衔接有效——turn-2 真的"在 turn-1 outcome 上展开"，不是重新答题

## 待解工程问题（不影响协议设计）

- Branch 命名 escape 特殊字符
- TUI ready 检测（先 `time.sleep(3)` 凑合）
- Outcome LLM 起草用 Anthropic API 直调还是临时 Claude TUI 当裁判？倾向 API 直调
- Agent 卡住的恢复：MVP 靠人 `tmux attach <name>` 看 + `brainstorm cancel <session>` 兜底
- Tmux session 命名前缀（避免和用户已有 session 冲突）：`brainstorm-<session>-<name>`
