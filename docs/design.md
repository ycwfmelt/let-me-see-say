# let-me-see-say · 设计文档

> 状态：MVP 实施完成，端到端跑过一次（见 `examples/`）。
> 最近更新：2026-04-27

本地多模型脑暴 orchestrator。多个参与者（CLI agent；未来还有 human）就一个主题在多个 turn 里层层深入；每 turn 内分两个 round（独立 + 收敛），turn 末尾产出 outcome 作为下一 turn 的种子。

本文档是当前架构的活文档（current state）。决策的来龙去脉看 `decisions.md`。延期项在 `TODO.md`。原始脑暴草稿在 `drafts/`。真实跑通过的 session 归档在 `examples/`。

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
- LLM 起草 outcome（MVP 写 stub 让人填；详见 `TODO.md`）
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

Agent 通过 `agents.toml` 注册（用户本地配置，gitignored；模板见 `agents.toml.example`）。Profile 名 = participant name。同 CLI 不同 model 是不同 profile：

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
post_start_keys = [""]   # Enter to accept "trust this directory" prompt

[agents.claude-with-custom-token]
cli = "claude"
env = { ANTHROPIC_OAUTH_TOKEN = "..." }
```

Orchestrator 启动 TUI 时把 `env` 注入子进程并执行 `cli + flags`（效果类似 `KEY=val claude --model sonnet`）。Branch / 路径都用 profile 名，协议层不知道 cli / model 是啥。

某些 CLI 第一次进新目录会显示交互 prompt（比如 codex 的 "Do you trust this directory?"）。Profile 可选 `post_start_keys: list[str]` + `post_start_delay: float`（默认 4.0s）：spawn cli 后等 delay 秒，再把每个 string 作为一行 send-keys 投出去。例如 codex 用 `post_start_keys = [""]`（Enter 接受 trust 默认选项）。

### Turn 形状

```
turn N:
  ├─ Phase 0/sync   (turn 1 是 boot；后续 turn 是把 turn N-1 的 outcome 投递给 participants)
  ├─ Round 1        (独立答题，互盲)
  ├─ Round 2        (看 anonymized round-1 池，收敛)
  └─ Outcome        (orchestrator 写 stub + 嵌入参与者答卷供 review；人编辑确认)
                       └─ 作为 turn N+1 的种子
```

**Outcome ≠ recap**：不是"把大家说的总结一下"，是"决定 / 厘清 / 列开放议题——下一轮在这上面展开"。文件 `outcome.md` 的 frontmatter `kind: decision | open-questions | summary` 区分形态。早期 turn 常常不收敛（kind = open-questions），中后 turn 逐步收敛到 decision。

**Outcome.md 同时承担两件事**：上半部分是给人编辑的决定区（kind / Decision / Direction / Notes），下半部分用 `<!-- BEGIN REVIEW MATERIALS -->` ... `<!-- END REVIEW MATERIALS -->` marker 包裹的"答卷参考区"，内嵌每个 participant 的 round-1 answer + round-2 refinement。这样人不用 `git show` 翻 participant 分支就能 review。投递给下一 turn 的 participants 时 marker 块会被 strip 掉（防止 raw 答卷泄漏到下一 turn，违反"outcome 是种子，不是答卷综合"——见 ADR-004 / ADR-006）。

### Task delivery：`.brainstorm/task.md`

每个 participant worktree 里 `.brainstorm/task.md` 是当前任务的 canonical 载体。orchestrator 每开新 phase：

1. 写 `.brainstorm/task.md`（这一轮要干啥）
2. Commit 到该 participant 分支：`task: <phase>: <name>`
3. 唤醒该 participant：
   - **TUIAgent**：`tmux send-keys "Read .brainstorm/task.md and proceed." Enter`
   - **Human (future)**：web UI 监测 task.md 变化 → 给人展示

Send-keys 只是 wake signal，内容在文件——避免 tmux 转义 / 引号 / 长度问题，且任意 participant 类型都用同一接口。

`tmux_ops.send_keys` 在 text + Enter 同时请求时把它们拆开发：先 send text，sleep 0.3s 让 TUI ingest 完，再 send Enter。否则慢启动的 TUI（codex booting MCP 时）会把 Enter 当成多行输入里的换行而不是 submit。

## 关键设计选择

详见 `decisions.md`。要点：
- **CLI agent 长生 TUI**（ADR-002）：跨 turn 保留 context，orchestrator 不重建历史
- **整 session 不做 mid-session merge**（ADR-003）：跨 participant 可见性由 orchestrator 文件投递控制
- **Turn = 深入；outcome 替 recap**（ADR-004）：turn 间传递的是"下一步要做什么"
- **Participant 抽象 + task.md 唤醒协议**（ADR-005）：agent + human 协议层等价
- **Outcome.md 嵌入答卷供人 review，投递时 strip**（ADR-006）：同一份 outcome.md 在 vault 里给人看时带答卷，给下一 turn agent 看时只剩决定

## 仓库 / vault 布局

仓库：

```
let-me-see-say/
├── docs/
│   ├── design.md             # 本文档
│   ├── decisions.md          # ADR 日志
│   ├── TODO.md               # 延期项
│   └── drafts/               # 原始脑暴草稿
├── brainstormd/              # orchestrator (Python)
│   ├── __init__.py
│   ├── __main__.py
│   ├── cli.py                # typer-based CLI
│   ├── orchestrator.py       # state machine + outcome / pool helpers
│   ├── participant.py        # Participant protocol + TUIAgent + Human stub
│   ├── git_ops.py            # worktree / commit / log poll / merge
│   ├── tmux_ops.py           # tmux wrapper (libtmux + send-keys)
│   └── prompts.py            # task.md 模板 + commit subject helpers
├── tests/                    # pytest 测试套（git_ops + tmux_ops + participant + ...）
├── examples/                 # 端到端跑通过的真实 session 归档
├── agents.toml.example       # agent profile 模板（committed）
├── agents.toml               # 用户实际配置（gitignored）
├── pyproject.toml            # uv + hatchling
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
│   └── outcome.md            # orchestrator 起草（含 review materials block），人编辑确认
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
│   └── outcome.md            # 上一 turn 完成、人确认后 orchestrator 投递（已 strip review block）
└── turn-2/<name>/
```

**关键不变量**：每个 participant 只看到自己的 `turn-N/<name>/`，看不到 siblings 的目录——因为不做 mid-session merge，orchestrator 投递的只有 round-1-pool（匿名）和 outcome（已确认且 stripped），不投递 raw 答卷。

Session finalize 时（一次性 merge）vault main 上才能看到所有人的答卷。

## 单 turn 详细流程

### Phase 0 · Setup（turn 1 一次性）

1. 人执行 `brainstorm new "topic" --vault <path> --with claude-sonnet,codex`
2. Orchestrator：解析 vault / workspaces 路径成绝对路径（`expanduser().resolve()`）→ 算 `session_id` → `mkdir + git init` vault session 目录 → 写 `00_topic.md`、`.brainstorm/rules.md` → main 上 commit `session init`
3. 对每个 participant：
   - `git worktree add <wt-path> -b participant/<session>/<name>`（vault session repo 的 worktree）
   - 启动 TUI：`tmux new -d -s brainstorm-<session>-<name> -c <wt>`
   - send-keys 启动 agent：`KEY=val ... cli flag1 flag2`（profile.env 通过 KEY=val 前缀注入）
   - 如果 profile.post_start_keys 非空：等 `post_start_delay` 秒后投递每个 key（用于像 codex 这种第一次启动有 trust prompt 的 CLI）
4. orchestrator `time.sleep(boot_settle_seconds=8)` 让所有 TUI 完成启动 + UI 渲染

### Phase 1 · Boot handshake（turn 1 一次性）

5. 对每个 participant：
   - 写 `.brainstorm/task.md`（boot 任务："Read rules.md, write ready file, commit"）
   - `git -C <wt> add .brainstorm/task.md && git -C <wt> commit -m "task: boot: <name>"`
6. send-keys 唤醒：`tmux send-keys "Read .brainstorm/task.md and proceed." Enter`
7. Participant 内部：读 task.md → 读 rules.md → 写 `.brainstorm/status/ready.<name>.md` → commit `ready: <name>`
8. orchestrator polls 每 ~2s：`git -C <wt> log -1 --format=%s participant/<session>/<X>`，匹配 `^ready: <X>$`
9. 全员就绪 → Phase 2

### Phase 2 · Round 1

10. 对每个 participant：写 task.md（round-1 任务："读 00_topic.md，独立写答卷到 turn-1/<name>/answer.md，commit"）+ commit + send-keys 触发
11. Participant：读 task.md → 读 00_topic.md → 写 `turn-1/<name>/answer.md` → 写 status → commit `turn-1: <name>`
12. orchestrator polls，全员交卷 → Phase 3

### Phase 3 · Round 2（orchestrator 跨 worktree 投递匿名池）

13. orchestrator 从每 participant 分支读 round-1 答卷（**不 merge**）：`git -C <vault-session> show participant/<session>/<X>:turn-1/<X>/answer.md`
14. orchestrator 把答卷 shuffle + 按 Reply A / Reply B / ... 加标签，生成 anonymized round-1 池（纯 Python，不调 LLM）；frontmatter 里记 anonymization map（reply A → claude-sonnet 等，仅 orchestrator 用）
15. 把池**复制到每个 participant worktree** 的 `.brainstorm/round-1-pool.md` + commit 到对应分支：`pool delivered: <name>`
16. 对每个 participant：写 task.md（round-2 任务："读 .brainstorm/round-1-pool.md，refine 你的观点，写到 turn-1/<name>/refinement.md，commit"）+ commit + send-keys
17. Participant：读 → 写 → commit `turn-1-r2: <name>`
18. orchestrator polls，全员收敛 → Phase 4

### Phase 4 · Outcome 起草 + 人编辑确认

19. orchestrator 从每 participant 分支用 `git show` 读 round-1 answer + round-2 refinement（不 merge）
20. 写 `turn-1/outcome.md`：
    - 上半部分是 stub（frontmatter `kind: ?` + Decision / Direction / Notes 占位）
    - 下半部分用 `<!-- BEGIN REVIEW MATERIALS -->` ... `<!-- END REVIEW MATERIALS -->` 包裹的参与者答卷
    - MVP 是模板组装；LLM 起草 outcome 是延期项（见 `TODO.md`）
21. 写到 vault main worktree + commit 到 main（subject `draft outcome: turn-N`）
22. CLI 提示人：outcome.md 路径 + "编辑后跑 `brainstorm next <session>`"
23. 人在 Obsidian 等编辑 outcome.md：填 kind 字段、Decision / Direction 区段。**不需要手动 commit**——`brainstorm next` 入口会 auto-commit dirty main

### Phase 5 · 衔接下一 turn（`brainstorm next`）

24. orchestrator auto-commit main 上未提交的人编辑（subject `outcome confirmed: turn-N`）
25. 读 vault main 的 `turn-N/outcome.md`，调 `_strip_review_materials` 剥掉 review block
26. 把 stripped 版本复制到每个 participant worktree 的 `turn-N/outcome.md` + commit 到对应分支：`outcome delivered: <name>`
27. 进入 turn N+1：写新一轮 task.md（"基于 turn-N/outcome.md 深入..."），跳到 Phase 2 → ... → Phase 4

### Phase 6 · Finalize（`brainstorm finalize`）

整 session 唯一的跨分支 merge，但**不是**直接 octopus——前面要做几步对齐准备，否则会 conflict：

28. **Capture pending main edits**：auto-commit main 任何未提交改动（subject `outcome edits captured before finalize`）
   - 防 git refuse merge into dirty working tree
29. **Strip review materials on main**：把每个 `turn-N/outcome.md` 的 review block 剥掉 + commit
   - 让 main 上的 outcome.md 内容和 participant 分支上的（已经 stripped 的）对齐，否则 octopus 看到同路径不同内容会 content-conflict
30. **Drop `.brainstorm/task.md` from each participant**：每个 participant worktree 删 task.md + commit `drop task.md before finalize: <name>`
   - task.md 内容因 participant + phase 不同而不同；保留会触发 octopus content conflict（其它 `.brainstorm/` 文件要么各 branch 同源同内容，要么路径唯一，不会冲突）
31. **Octopus merge**：`git merge --no-ff <branch1> <branch2> ...` 把所有 participant 分支并入 main
32. **Stop tmux + mark FINALIZED**：每个 participant `p.stop()`（kill tmux session），session.json 改 `current_phase = finalized`

Finalize 后 vault main 上能看到所有 participant 的 raw `answer.md` / `refinement.md`（来自 merge），加上人确认的 `outcome.md`（已 stripped），跨 turn 的完整 commit 历史也都在。

## MVP 范围（已实施）

- 2 个 agent profile：`claude-sonnet` + `codex`
- 1 session、≥2 turn（端到端跑通过 3 turn）
- 文件协议（无 MCP）
- `--vault` flag（无 `brainstorm init` 全局配置）
- Filesystem-only（无 SQLite）
- 只实现 TUIAgent（无 Human，留 stub）
- 无 role 注入（协议槽位留好）

验证过的三件事：
1. tmux send-keys + task.md 读取链路稳
2. git commit 作交卷信号可检测
3. outcome 跨 turn 衔接有效——turn-2 真的"在 turn-1 outcome 上展开"，不是重新答题

详见 `examples/2026-04-26_multi-agent-brainstorm/`。

## 待解工程问题（不影响协议设计）

- **Branch 命名 escape 特殊字符**：当前没处理，主题里有奇怪字符可能产生奇怪 branch 名
- **TUI ready 检测**：MVP 用固定 `boot_settle_seconds=8` + `post_start_delay=4`；后续可以 capture-pane 主动 sniff "ready" 状态
- **Outcome LLM 起草**：MVP 是模板 stub，让人从零写。延期项见 `TODO.md`
- **Agent 卡住的恢复**：MVP 靠人 `tmux attach <name>` 看 + `brainstorm cancel <session>` 兜底；超时 / 重启自动化未做
- **Tmux session 命名前缀**：已实施 `brainstorm-<session>-<name>`
- **Session purge / cleanup 命令**：失败的 session 现在要手动 rm vault dir + worktree + 杀 tmux；见 `TODO.md`
