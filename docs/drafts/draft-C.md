Multi-Agent 脑暴工具 · 讨论纪要
核心需求
实现 Mixture of Agents (MoA) 模式的脑暴工具：
	•	用户提出主题，多个大模型独立思考、各自给出回复（强隔离，不受彼此影响）
	•	汇总所有回复后，每个模型在看到全部回复的基础上再回复一轮
	•	每轮结束生成 turn recap，进入下一轮
技术约束
	•	Claude Code 和 Codex CLI 都是订阅授权（非 API 计费），只能在各自 CLI 里使用
	•	其他模型（Gemini、DeepSeek、Qwen 等）走 OpenRouter API，一个 key 搞定
最终方案
进程编排：tmux
每个 agent 一个独立 tmux session，orchestrator 通过 tmux send-keys 注入 prompt 唤醒 agent。tmux 只负责”敲门叫醒”，不负责传递状态。
数据层：Obsidian vault + git
Vault 作为”答题纸 + 黑板”，目录结构：

vault/brainstorm/<session>/
├── 00_topic.md
├── agents/                     # 每个 agent 的人设/能力声明（借鉴 A2A Agent Card）
│   ├── claude.md
│   ├── codex.md
│   └── gemini.md
├── turn-1/
│   ├── claude.md               # 各自的答题卡
│   ├── codex.md
│   ├── gemini.md
│   └── recap.md                # 交卷后的汇总
├── turn-2/
│   └── ...
└── final.md


Vault 同时是 git repo，一举两得：
	•	Codex 默认要求在 git repo 内运行，刚好满足
	•	版本历史可追溯、可回滚、跨设备同步
	•	你可以随时打开 Obsidian 人工介入（改 recap、加 system note、调整 topic）
同步机制：git 即权限、git 即时序
这是整个方案最优雅的一点——用 git commit 时序天然实现”隔离 + 同步”两个看似矛盾的需求：
	•	第一轮（隔离）：各 agent 启动时 pull，pull 不到任何同辈输出 → 强隔离思考
	•	交卷信号：agent 写完文件后 git add && git commit -m 'claude: turn 1'
	•	Orchestrator 等待：watch git log，所有 agent 都 commit 了 → 生成 recap → commit
	•	第二轮（同步）：send-keys 让 agent git pull 并阅读 turn-1/recap.md → 强保证看到全部回复
不用写任何权限控制代码，git 的时序就是权限。
Agent 的工作模式
每个 CLI agent 收到的指令大致是：
“Pull 最新代码 → 阅读 00_topic.md 和 agents/<self>.md（你的人设）→ 写出你的思考到 turn-N/<self>.md → commit。”
第二轮则增加：“读 turn-(N-1)/recap.md 看看其他人怎么说，再写 turn-N/<self>.md”。
Claude Code 走 claude -p，Codex 走 codex exec，订阅鉴权都自动生效。注意：订阅模式下 Claude Code 不能加 --bare（会强制要求 ANTHROPIC_API_KEY）。
A2A 协议：暂不引入
A2A 是为跨厂商、跨网络、互相不可见的 agent 设计的协议。你的场景是本地、全控制、要求透明，正好相反；而且 Claude Code / Codex 都不是 A2A server，要用得包一层 wrapper，纯属增加复杂度。
只借鉴两个概念：
	•	Agent Card 思路 → agents/*.md 给每个 agent 声明人设
	•	Task / Artifact 术语 → 用于命名目录结构
未来如果要接外部 agent 或对外暴露脑暴系统，再考虑 A2A。
明天的起步建议
先做最小闭环再扩展：
	1.	两个 agent（Claude Code + Codex）+ 两轮迭代，跑通完整流程
	2.	验证三件事：tmux send-keys 唤醒可靠、git commit 作为交卷信号可检测、recap 注入下一轮有效
	3.	闭环跑通后再加：第三个 agent（OpenRouter）、人设系统、final 收敛步骤、Obsidian Dataview 跨 session 索引