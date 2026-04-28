# 决策日志

按时间顺序追加的设计决策日志。每条：日期、决策、上下文、考虑过的替代方案、结论 / 后续。

**约定：不要修改旧条目。** 如果某个决策被新决策推翻，写一条新条目，把旧条目状态改成 `Superseded by ADR-NNN`，但内容保留。这样未来回看才能看到演进路径。

---

## ADR-001 · 从三份 draft 综合出本架构（2026-04-25）

**状态：** Accepted

**决策：** 采纳 `drafts/draft-A.md`、`drafts/draft-B.md`、`drafts/draft-C.md` 共同收敛出来的核心：
- 文件持久化（Obsidian vault）
- tmux send-keys 驱动 CLI agent
- 回合制隔离，git 同时充当隔离原语和 turn 信号机制
- recap 作为 turn 间上下文
- Round 2 匿名化呈现
- 上 MCP 做"房间服务器"，但 MVP 不做

**上下文：** 三次脑暴（主要和 Claude）产出三份 draft，从略微不同角度逼近同一个问题。

- draft-A：偏 orchestrator 细节、状态机、prompt 组装
- draft-B：用"黑板/考场"比喻最简洁
- draft-C：提出 tmux + git worktree + git-commit-as-submission，是操作上最具体的设计

三份 draft 的共识比分歧大得多。本次综合主要是把 draft-C 的具体机制 + draft-A 的流程纪律 + draft-B 的角色比喻拼到一起。

**考虑过的替代方案（被搁置）：**
- 把 Obsidian 当 agent 共享工作区 → draft-A §5 已论证为何不合适（其他 agent 草稿污染、Obsidian 配置文件污染）
- 直接借鉴 A2A 协议 → draft-C §"A2A 协议"已论证：A2A 是为跨厂商、跨网络、互不可见的 agent 设计的，与本场景（本地、全控制、要求透明）相反
- 不要 git，纯文件 polling → 失去时序保证；git commit 时序天然实现"隔离 + 同步"
- 直接上 LangGraph / 复杂任务队列 → 对 MVP 是过度工程

**结论 / 后续：**
- worktree-per-agent 做隔离
- MVP = 2 agent + 2 turn + 文件协议（推迟 MCP）
- Obsidian 是合并后状态的只读消费方（人在读），不是协调通道
- 第二轮做匿名化 + shuffle，减少品牌偏见

---

## ADR-002 · Agent 用长生 TUI session，不用 `-p`/`exec`（2026-04-25）

**状态：** Accepted（推翻 draft-A §9 和 draft-C 中 `claude -p` / `codex exec` 配方的相关部分）

**决策：** 每个 agent 在 tmux 里以交互 TUI 模式（`claude`、`codex` 不带任何 flag）启动并跨 turn 存活；orchestrator 通过 `tmux send-keys` 投递每轮指令；done-signal 是 agent branch 上的 git commit。

**上下文：** 初版方案（draft-A §9 的"CLI Adapter"、draft-C 的"Claude Code 走 `claude -p`，Codex 走 `codex exec`"、以及第一次综合时的初稿）建议每轮调用 `claude -p "<完整 prompt>"` 和 `codex exec`。这要求 orchestrator 每轮重建 agent 的历史并重新喂入。

**理由：** 用户在审议第一次综合时指出，orchestrator 侧的历史重建必然有损，且会破坏 agent 的身份连续性。让 TUI 模式 agent 自己的 context window 跨 turn 保留是忠实且廉价的——skill 在 TUI 启动时已加载、agent 也已记得前几轮，所以每轮指令缩成一句短话就行（"Round 2: pull, read recap, critique, commit"）。

**考虑过的替代方案：**
- 每轮 `claude -p` + 重建历史 → 拒绝，有损
- TUI 长生但 orchestrator 通过 MCP 每轮喂新上下文 → 没必要，agent 自己记得
- 启动 TUI 但每轮 `tmux kill-session` 重启 → 等同于 `-p` 方案，丢失上下文

**结论 / 后续：**
- 删掉 `--bare` 注意事项（只在 `-p` 模式下相关）
- 删掉 `codex exec --output-last-message`（只在 exec 模式下相关）
- Done-signal 必须是 git commit（TUI 没有 process-exit 信号），orchestrator poll `git log`
- Round-2 匿名化只能保护"Claude vs Codex"身份，不能保护"自己 vs 他人"——agent 会在匿名输入里认出自己 round-1 的回复。可接受。
- 长 TUI session 的 auto-compaction 是未来问题（>10 turn 才需关注）；不影响 MVP

---

## ADR-003 · 整 session 不做 mid-session 跨 participant merge（2026-04-25）

**状态：** Accepted

**决策：** Round 1 收卷后，**不**把任何 participant 的分支 merge 到 main。Round 2 给 participant 的输入（anonymized round-1 池、turn outcome 等）由 orchestrator 主动写到每个 participant 的 worktree 并 commit 到该 participant 分支，**不通过 git merge 跨分支传播**。Session 结束 finalize 时才做一次性 merge 归档。

**上下文：** 早期方案隐含假设：round 1 收卷后 orchestrator 把 agent 分支 merge 到 main，agent round 2 通过 `git merge main` 拉到 main 内容。问题：main 上一旦有 siblings 的 raw 答卷，agent merge 进来就破坏了 round 2 应该看到的"匿名 outcome 而非原始答卷"的隔离要求。

**理由：** Git merge 的语义是"看到全部"；本系统对 round-2 信息可见性的要求是"只看到匿名后的 round-1 池"。两个语义对不上。强行 selective / cherry-pick / partial merge 复杂且易错。直接放弃跨分支 merge——让 git 只承担"参与者个人日志 + 交卷信号 + 时序保证"的角色；跨参与者可见性完全由 orchestrator 文件投递控制（`git -C <wt> add && commit` 到对应分支）。

**考虑过的替代方案：**
- 收卷 merge 到 main，round-2 prompt 强调"只读 outcome.md" → 靠模型自律，弱保证
- 两条 main：archive（全合并）+ dispatch（只投匿名）→ agents 拉 dispatch、人看 archive；可行但两 main 复杂
- git sparse-checkout 限制 agent 可见路径 → 平台依赖、配置易错

**结论 / 后续：**
- 每个 participant 分支自始至终只有：起手共享内容（topic / rules）+ 自己的 commit + orchestrator 投递（task.md / round-1-pool.md / outcome.md）
- Vault 目录 = main 的 worktree。Session 进行中 orchestrator 直接写 outcome 到 vault main 给人看，不依赖跨分支 merge
- Session 结束（`brainstorm finalize`）才把所有 participant 分支 merge 到 main 做归档——整个 session 唯一一次跨分支 merge

---

## ADR-004 · Turn 是深入而非综合，outcome 替代 recap（2026-04-25）

**状态：** Accepted

**决策：**
1. 一个 brainstorm session 是同主题的多 turn 层层深入，类似一段持续对话——**不**是各 turn 独立小问题
2. 每个 turn 末尾产出 `outcome.md`（不再叫 recap），形态可以是 decision / open-questions / summary 中任一种，frontmatter `kind` 字段标注
3. Outcome 是下一 turn 的种子——下一 turn 在 outcome 上展开，**不**对 outcome 评论或重复总结
4. Outcome 由 LLM 起草 → 人编辑确认 → 然后才能 `brainstorm next` 推进

**上下文：** 早期方案把每 turn 末尾的产出叫 recap，语义偏向"把大家说的总结一下"。用户指出真实形态是"这一轮大家各抒己见，最后拍板决定一个方案，下一轮按这个方案路线深入"——这是前向决策 / 厘清，不是后向综合。

**理由：**
- "Recap = 总结答卷"的命名诱导系统朝"信息归纳"方向走；真实价值在"决定下一步往哪走"
- 但也不能锁死成 `decision.md`——early turn 经常不收敛（澄清新问题 / 列开放议题），强制每轮拍板会扭曲讨论自然形态
- "Outcome" 是中性词，schema 里 `kind: decision | open-questions | summary` 让每轮形态可异

**Role 卡相关决定：** MVP 不实现，但**协议槽位保留**——`Participant.role: Optional[str]` 字段 + prompt 模板的 `{{role_section}}` 注入位都已经留好。原因：纯靠模型自然倾向，多 LLM 输出趋同（都偏四平八稳）；尤其"用户视角"这种"故意唱反调"的角色对脑暴价值放大显著（draft-A §12）。MVP 不做是为了简化，不是因为没价值——所以 `docs/TODO.md` 留 item 等触发。

**结论 / 后续：**
- 文件名 `outcome.md`（不再用 `recap.md`），schema 含 `kind` / `anonymization` / 内容
- LLM 起草 + 人编辑确认是默认路径
- 下一 turn 的 round-1 task 让 participant 在 outcome 上展开，不要求他们"再总结一遍"

---

## ADR-005 · Participant 抽象统一 agent + human；task.md 作唤醒协议核心（2026-04-25）

**状态：** Accepted

**决策：**

1. 协议层用 `Participant` 作为统一抽象，agent 和 human 都是 participant 子类型。每个 participant 都有：name / worktree / 分支 / join 流程 / 按 turn 提交 / git commit 当 done signal——这些对所有类型一样
2. Task delivery 走 `<worktree>/.brainstorm/task.md`：orchestrator 每开新 phase 写 task.md 并 commit 到 participant 分支（subject `task: <phase>: <name>`），participant 读 task.md 来知道这一轮干啥
3. **唤醒方式因类型而异，但内容载体一样**：
   - **TUIAgent**: orchestrator `tmux send-keys "Read .brainstorm/task.md and proceed."`——send-keys 只是触发，内容在文件
   - **Human (future)**: web UI 监测 task.md 变化 → 在界面展示 → 捕获 human 输入 → 写 `turn-N/<self>/answer.md` + commit。Human 不直接维护 worktree / commit
4. **MVP 实现层只做 TUIAgent**，Human 留 stub。协议层完全可用于 human，等 web UI 来时实现 Human 类即插即用

**上下文：** 用户提议人也能加入 brainstorm，并明确比作"狼人杀"——human 每轮拿到一个明确 task（牌），提交后等下轮。早期方案把人作为"答题纸的读者 + topic 写者"，人不是 first-class participant；新模型让 human 和 agent 在协议层对等。

**理由：**
- 协议层泛化（branch / 文件结构 / task.md / status）成本几乎为零，不做后面要重构
- 实现层延后 human（async / 通知 / UX）成本与价值比 MVP 阶段不划算——agent-only 端到端先验证机制是否对
- task.md 作为"当前任务"载体的好处：
  - 解耦内容和触发：send-keys 不需要把整段 prompt 塞进 tmux pane，避免转义 / 引号 / 长度问题
  - 任意 participant 类型都通过这个接口拿任务，agent 和 human 等价
  - 任务有审计：task.md 的 commit 历史就是"每个 participant 在每个 phase 被要求干什么"的完整记录
  - Agent 重启或卡住后，重新让它读 task.md 即可，不需要重发 prompt

**Agent profile 配置（同 ADR）：** Agent 通过 `agents.toml` 注册成 profile，每个 profile = `cli` + `flags` + `env`：

```toml
[agents.claude-sonnet]
cli = "claude"
flags = ["--model", "sonnet"]

[agents.claude-with-custom-token]
cli = "claude"
env = { ANTHROPIC_OAUTH_TOKEN = "..." }
```

启动时 orchestrator 用 `env` 注入子进程并执行 `cli + flags`（效果类似 `KEY=val claude --model sonnet`）。Branch / 路径用 profile 名（`claude-sonnet`），协议层只看名字。同 CLI 不同 model 是不同 profile = 不同 participant。

**考虑过的替代方案：**
- Send-keys 直接投递整个 prompt：转义 / 长度 / 内容审计问题
- 用 stdin 给 agent CLI：TUI 模式不接受 stdin
- Push notification 给 human 取代 task.md：后续 web UI 可加，但 task.md 是 single source of truth

**结论 / 后续：**
- `Participant` interface 定义 `wake_for(phase)` / `is_done(phase)` 等方法；TUIAgent 实现 send-keys + git poll；Human 留 NotImplementedError stub
- `.brainstorm/task.md` 加入文件协议，每 phase orchestrator 写 + commit
- `agents.toml` 进入仓库，example profiles 含 `claude-sonnet` / `claude-opus` / `codex`
- Branch 命名 `participant/<session>/<profile-name>`

---

## ADR-006 · Outcome.md 嵌入参与者答卷供 review，投递时 strip（2026-04-27）

**状态：** Accepted

**决策：** `turn-N/outcome.md` 在 vault main 上同时承担两种角色：
1. **决定区**（顶部）：给人编辑——frontmatter `kind` + `## Decision / Direction` + `## Notes`，是下一 turn 的种子
2. **答卷参考区**（底部）：用 `<!-- BEGIN REVIEW MATERIALS -->` ... `<!-- END REVIEW MATERIALS -->` 包裹，内嵌每个 participant 的 round-1 `answer.md` + round-2 `refinement.md` 内容

`_deliver_outcome_to_participants` 在投递 outcome 给下一 turn 的 participants 之前调 `_strip_review_materials` 把 marker 块整个剥掉。下一 turn 的 round-1 task 只能看到人确认的决定，看不到上一轮所有 raw 答卷。

`finalize` 在 octopus merge 前也要 strip vault main 上所有 outcome.md（让 main 与 participant 分支上对齐），否则 git 会撞 content conflict。

**上下文：** 用户跑第一个 session 时反馈：outcome.md 让我"review participant answers + refinements 然后 write outcome"，但 raw 答卷只在 participant 分支上（per ADR-003 不做 mid-session merge），main 上看不到。需要 `git show <branch>:<path>` 才能看，UX 不能接受。

**理由：**
- 把答卷拷到 vault main 给人看是合理的——人是 first-class reviewer，需要可见性
- 但下一 turn 的 participant 不能看到上一轮 raw 答卷（违反 ADR-004 "outcome 是种子，不是答卷综合"——他们 round 2 看到的是匿名池，下一 turn 又看到去名字的 raw 答卷会让信息泄漏路径不对称）
- 同一个 outcome.md 在两边角色不同，用 marker 隔开 + 投递时 strip 是最简单的方式
- Marker 用 HTML comment 风格（`<!-- ... -->`）：对 markdown 渲染透明（Obsidian 等显示时不会显示 marker 本身）、对人编辑也清楚、对正则匹配稳定

**考虑过的替代方案：**
- 两份不同文件 `outcome.md`（给人）+ `_outcome-clean.md`（给 participant）→ 两文件状态难同步，文件多
- 让 outcome.md 不嵌入答卷，人手动 `git show` →  UX 不可接受
- 嵌入答卷且不剥离投递给 participant → 破坏 ADR-004 的 "outcome 是种子" 不变量
- 把答卷作为不同文件投递（`turn-N/<name>/answer.md` 等也复制到每个 participant worktree）→ 直接破坏 round-1 互盲

**结论 / 后续：**
- `_draft_outcome` 写 outcome.md 时通过 `_build_review_materials` 嵌入参与者答卷
- `_deliver_outcome_to_participants` 调 `_strip_review_materials` 后再写到 participant worktree
- `finalize` 在 octopus merge 前调 `_strip_main_outcomes_for_merge` 把 main 上所有 outcome.md 也 strip 一次（让 main 与 participant 分支对齐）
- Marker 字符串以常量形式 export 到 `orchestrator.REVIEW_BEGIN_MARKER` / `REVIEW_END_MARKER`，模板 + strip 用同一对常量保证一致

---

## ADR-007 · Artifact 支持：agent 可产出 HTML 原型，由 outputMode 控制（2026-04-28）

**状态：** Accepted

**决策：**
1. 新增 session 级 `outputMode` 字段（`"md-only"` | `"md-and-artifact"`），控制本 turn 是否要求 participant 产出 artifact
2. Artifact 是单文件 HTML+CSS+JS，路径 `turn-N/<name>/artifact.html`（round-1）和 `turn-N/<name>/artifact-r2.html`（round-2，可选）
3. `outputMode` 在创建 session 时设置，可在 advance 时修改（outcome editor 提供 next-turn 切换）
4. Round-1 pool 中注明"此 Reply 附带 HTML 原型"但不嵌入 artifact 内容——匿名池仍为纯 markdown
5. Review materials block 用 `<!-- artifact:r1:<name> -->` / `<!-- artifact:r2:<name> -->` marker 标记有 artifact 的 participant，前端通过 API 获取 artifact 并在 sandboxed iframe 中预览
6. Artifact 文件在 `draftOutcome` 时从 participant 分支 `git show` 拷贝到 vault main 的 `turn-N/<name>/` 目录（与 outcome.md 一起 commit），供 review 使用

**上下文：** UX / 设计类脑暴主题中，纯 markdown 描述不够直观。Agent（如 Claude）完全有能力生成自包含的 HTML 文件作为低保真原型。目录结构 `turn-N/<participant>/` 本就支持任意文件类型（参见 TODO.md "Artifact 多形态"），此 ADR 激活了这个能力。

**理由：**
- 最简路径：单文件 HTML（inline CSS/JS，无外部依赖）= agent 最容易产出、用户最容易预览的 artifact 形态
- `outputMode` 作为 session 级而非 turn 级配置，简化状态管理；advance 时可选覆盖兼顾灵活性
- Round-1 pool 不嵌入 artifact HTML（会让匿名池过长且破坏 markdown 可读性），只标注"有 artifact"让 round-2 participant 知道这件事
- Sandboxed iframe（`sandbox="allow-scripts"`，不含 `allow-same-origin`）预览 artifact，防止 XSS

**考虑过的替代方案：**
- 每 turn 单独设 outputMode → 状态多、UI 复杂，实际大部分 session 全程同一 mode
- Artifact 嵌入 round-1 pool → pool 变太长，且 HTML 在 markdown 里不可读
- 多文件 artifact（JS/CSS/图片分文件）→ 复杂度剧增，低保真原型不需要

**结论 / 后续：**
- `prompts.ts` round-1/round-2 task 模板在 `artifact=true` 时追加 artifact 指令
- `orchestrator.ts` 的 `draftOutcome` 收集 artifact 文件并拷贝到 vault main
- 新增 API route `GET /api/sessions/[id]/artifact?participant=&turn=&round=` 提供 artifact HTML
- `ArtifactPreview` React 组件用 sandboxed iframe 渲染，集成到 `ReviewMaterials` 和 `OutcomeEditor`
- `rules.md` 增加 artifact 段落说明协议约束

---
