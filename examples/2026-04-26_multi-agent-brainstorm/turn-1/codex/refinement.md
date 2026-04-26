# Round 2 refinement

看完 Reply A 和 Reply B 后，我会把建议收敛成一句话：

**这个工具应该先按“协议优先”的方式做，而不是按“多 agent 框架优先”或“聊天 UI 优先”来做。** 核心资产是 blind round protocol、上下文可审计、recap 进入下一 turn 的规则；模型接入和 UI 都是可替换层。

## 我采纳的观点

Reply A 对问题本质的判断是对的：这是 orchestration 问题，不是模型能力问题。第一轮互盲不靠模型自觉，而靠编排器不把其他回复放进上下文。

Reply A 提到的两条实现路径也很有价值：

- API 直调：最适合 MVP，简单、可测、可复现。
- 长生 CLI agent + tmux/git：更接近“多个参与者在同一个流程里工作”，也适合需要保留 agent 身份和跨 turn 连续性的场景。

我会把这两者合并成产品路线：

1. **MVP 用无状态 API orchestrator**，把协议跑通。
2. **第二阶段再支持 persistent participant adapter**，例如 CLI agent、tmux pane、远程 worker、或者自托管模型。
3. 所有 adapter 都必须服从同一个 session/turn/round 协议，不允许绕过信息流控制。

## 我修正的观点

我原先更强调现成产品可以先试。看完 Reply A 后，我会更明确地区分：

- **评估现成产品**：适合快速验证“多模型一起讨论有没有用”。
- **实现目标系统**：大概率还是要自建，尤其当你要求第一轮严格互盲、第二轮匿名池、recap 可编辑且可追溯。

所以我的更新建议是：可以试 AISCouncil / CouncilMind 作为参考体验，但不要把它们当成最终方案的默认前提。真正要做稳，应该从自建最小 orchestrator 开始。

## 我不同意或需要谨慎的点

Reply A 认为长生 CLI agent 的优点是保留跨 turn context window。这个优点确实存在，但我会把它设为高级模式，而不是默认模式。

原因是：隐藏在模型上下文窗口里的“记忆”不可审计，也可能破坏你想要的实验控制。对于脑暴系统，默认跨 turn 记忆应该只来自 `outcome.md` / recap，而不是某个 agent 自己暗中保留的一长串历史。否则下一 turn 的输入边界会变模糊，很难回答“这个观点到底是从哪里来的”。

更稳的设计是：

- 默认：每轮无状态调用，只喂 topic + selected history + previous recap。
- 可选：persistent participants，但必须记录每次实际发送的 task、可见文件列表、commit/status 信号。
- 对比实验：同一个 session 可以混用 stateless model 和 persistent agent，但 UI 要标出来。

## 推荐的最终架构

我建议拆三层：

**1. Protocol layer**

负责 session、turn、round、pool、recap、status。它定义信息流：

- Round 1 participants 只能看 topic 和上一 turn recap。
- Round 1 全部完成后才生成匿名 pool。
- Round 2 participants 只能看 topic、上一 recap、匿名 pool。
- Recap/outcome 是下一 turn 的唯一默认记忆入口。

**2. Participant adapter layer**

统一不同模型/agent：

- OpenAI / Anthropic / Gemini / OpenRouter 这类 API adapter。
- Ollama / vLLM 这类本地模型 adapter。
- CLI agent adapter，例如 Claude Code、Codex、Gemini CLI，通过文件和 commit/status 协作。

**3. Review UI layer**

不是普通聊天 UI，而是 round-based console：

- 等待所有 Round 1 完成后统一 reveal。
- 显示每个 reply 在 Round 2 后“坚持了什么、改变了什么、反驳了什么”。
- 支持人类编辑 recap。
- 保留 prompt hash、输入上下文、模型参数、token/cost、错误重试记录。

## MVP 范围

第一个可用版本我会这样做：

- `session.yaml`：配置 topic、participants、models、temperature、round timeout。
- `run round1`：并发调用所有 participant，写入 `turn-1/<participant>/round-1.md`。
- `build-pool`：匿名、随机排序、生成 `.brainstorm/round-1-pool.md`。
- `run round2`：把匿名池发给所有 participant，写入 refinement。
- `recap`：生成 draft outcome，人类可编辑后进入下一 turn。

暂时不做复杂权限系统、不做华丽 UI、不做自动多轮无限循环。先证明这个 protocol 真的能产出更好的决策。

## 最重要的产品原则

这个系统不应该追求“模型们聊得很热闹”，而应该追求“观点来源清楚、分歧保留、收敛过程可解释”。如果要做成产品，我会把功能优先级排成：

1. 信息流隔离和可审计。
2. 高质量 recap/outcome。
3. 多 provider 接入。
4. 好用的 review UI。
5. persistent agent 和高级自动化。

也就是说，先把“盲评 -> 匿名交叉审阅 -> 可编辑 recap -> 下一 turn”做成稳定协议，再考虑更多 agent 框架或交互效果。
