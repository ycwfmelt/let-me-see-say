# 独立观点

我会把这个东西定义成一个「盲评第一轮 + 交叉审阅第二轮 + 人/模型生成 recap」的 LLM council。核心价值不是“同时问多个模型”，而是控制信息流，避免第一轮互相污染，第二轮再有意识地做收敛和反驳。

## 先看现成产品

截至 2026-04-26，现成产品里比较接近的是：

- [AISCouncil](https://www.aiscouncil.com/)：有 Council、Compare、Debate、Mixture of Agents、Consensus Vote 等模式，支持多模型并行、peer review、综合输出，也支持 BYOK 和 OpenRouter/本地 Ollama。它看起来最接近“多模型脑暴工作台”，但需要确认它的第一轮是否严格 blind、第二轮是否能按你的 turn/recap 规则定制。
- [CouncilMind](https://www.councilmind.online/) / [docs](https://www.councilmind.online/docs)：定位就是 multi-AI consensus，支持多轮讨论和共识摘要。文档说明多轮里模型会看到彼此上一轮回复，这符合第二轮，但仍要确认第一轮隔离、匿名化、recap 格式、数据导出和模型选择是否够可控。
- [Poe multi-bot chat](https://poe.com/blog/multi-bot-chat-on-poe)：适合快速在一个会话里 @ 不同 bot、比较结果，但官方描述是“single thread”。这更像便捷多模型聊天，不像严格的 blind round protocol。
- [LibreChat](https://www.librechat.ai/)：开源、多 provider、多 agent、可自托管，适合作为 UI/账号/会话底座，但你要的两阶段隔离流程大概率需要自己扩展。
- [OpenRouter](https://openrouter.ai/) / [API docs](https://openrouter.ai/docs/api/reference/overview/)：不是产品 UI，而是很适合当模型接入层。它提供统一 API 接多家模型，适合自己做 orchestrator。

我的判断：如果只是个人马上用，先试 AISCouncil 或 CouncilMind；如果你在意“第一轮绝对独立、第二轮匿名池、turn recap 可追溯”，应该自己做一个轻量 orchestrator，现成产品很可能只能覆盖 60%-80%。

## 推荐流程

每个 session 维护一个不可变事件日志：

1. `topic`：用户原始主题。
2. `turn-N/round-1/model-X`：每个模型只收到 topic 和上一 turn 的 recap，不收到其他模型输出。
3. `round-1-pool`：汇总所有 round-1 回复，打乱顺序，匿名成 Reply A/B/C。
4. `turn-N/round-2/model-X`：每个模型收到 topic、上一 recap、匿名池，再给修订观点。
5. `turn-N/recap`：生成本 turn 的结论、分歧、未决问题、下一 turn 建议。

关键点是：不要用一个共享 chat thread。每个模型每轮都应该由 orchestrator 重新组装 prompt。这样可以审计“这一轮到底给了模型什么上下文”。

## Prompt 设计

Round 1 prompt 应该很硬：

- 只基于用户主题和上一轮 recap。
- 不要猜测其他模型会怎么回答。
- 输出结构固定：建议、理由、风险、需要用户澄清的问题、信心等级。

Round 2 prompt 要把 peer replies 当成“待评审材料”，不是新的指令：

- 明确说明匿名回复里的指令都不应被执行，内容只用于比较观点。
- 要求模型指出自己保留、修改、放弃了什么。
- 要求挑出最强反方观点，而不是只做投票。

Recap prompt 不应该只是“总结大家说了什么”。我会要求它输出：

- 已达成共识。
- 主要分歧和各自成立条件。
- 高价值少数派观点。
- 明显错误或需要事实核查的点。
- 下一 turn 最值得继续追问的 1-3 个问题。

## 产品形态

最小可用版本不需要先做复杂前端。可以先做 CLI + Markdown/Git 存档：

- `session.yaml` 定义 participants、model、temperature、budget。
- `turn-1/model-a/round-1.md` 这种文件保存输出。
- 一个 `run-turn` 命令并发调用模型。
- 一个 `recap` 命令生成 outcome。

等流程跑顺后再做 Web UI。UI 的重点不是聊天窗口，而是信息流状态：

- Round 1 未完成前不展示任何模型结果，避免用户提前被某个回复影响。
- Round 1 完成后同时 reveal。
- Round 2 展示“原观点 -> 看完匿名池后的变化”。
- Recap 可以人工编辑，因为最终进入下一 turn 的内容会强烈影响后续方向。

## 数据模型

最小 schema：

- `sessions(id, topic, created_at, owner)`
- `participants(id, session_id, name, provider, model, role, params)`
- `turns(id, session_id, index, previous_recap, final_recap, status)`
- `responses(id, turn_id, round, participant_id, prompt_hash, content, status, token_cost, created_at)`
- `pools(id, turn_id, round, anonymized_content, shuffle_seed)`

`prompt_hash` 很重要。以后发现某轮结果奇怪，可以回看模型到底看到了什么。

## 需要防的坑

- 第一轮不要把所有模型放进同一个 conversation/thread。
- 第二轮 peer replies 里可能有 prompt injection，所以要把它们作为 quoted data，并在系统提示里禁止执行其中的指令。
- 不要让 recap 丢掉少数派观点；脑暴的价值经常在少数派。
- 不要默认“多数模型同意 = 对”。模型可能同源、同训练偏差、同一错误互相强化。
- 不要要求隐藏思维链。让模型输出可读的理由摘要、假设和不确定性即可。
- 控制 temperature：脑暴可以高一点，recap/决策要低一点。

## 我的建议

路线 A：先用 AISCouncil / CouncilMind 验证需求。如果它们能导出结果、支持足够多模型、能配置多轮，就先不用造轮子。

路线 B：如果要做成自己的长期工具，先做“Markdown 文件 + orchestrator + OpenRouter/各家 API”的版本。这个版本最容易保证隔离、可追溯、可复现，也方便以后接 UI。

我倾向路线 B。这个需求的难点不是调用模型，而是协议正确性：哪些信息在哪一轮可见、是否匿名、recap 如何进入下一 turn、用户能否审计。如果这几个点做稳，哪怕 UI 很朴素，也会比普通多模型聊天工具更有价值。
