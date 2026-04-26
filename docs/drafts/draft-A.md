我们讨论出来的方案可以概括成一句话：

做一个 本地多模型盲评脑暴 orchestrator：每个 agent 在独立房间里先答题，交卷后再互相批阅；Obsidian 作为答题纸、档案库和人类阅读界面。

1. 核心目标

你想要的不是普通的“多个模型同时回答”，而是一个更严格的脑暴流程：

user 发起主题
  ↓
每个模型独立思考，互相不可见
  ↓
收集所有模型的第一轮回复
  ↓
每个模型在看到所有回复后再进行第二轮判断
  ↓
生成 synthesis 和 turn recap
  ↓
recap 进入下一 turn

关键要求是：

第一轮必须互不影响
第二轮才允许互相参考
每个 turn 都要沉淀 recap
下一轮不依赖模型自己的历史 session，而依赖系统维护的 recap


⸻

2. 产品定位

因为你的 Claude Code 和 Codex 都是 订阅制 CLI，不是 API 计费，所以不适合做成普通的 LLM API fan-out 系统。

最终定位应该是：

本机个人脑暴控制台 / local multi-agent brainstorm orchestrator

而不是线上 SaaS。

原因是 Claude Code / Codex 依赖本机登录状态、CLI 环境、OAuth / keychain 等，本地运行更自然。

⸻

3. 总体架构

推荐架构：

                 Obsidian Vault
          答题纸 / 档案库 / 人类阅读 UI
                       ↑
                       │ Markdown 文件
                       │
        brainstorm orchestrator
  发卷 / 收卷 / 匿名化 / 调度 / 总结 / recap
          │             │
          │             │
          ↓             ↓
   Claude private room   Codex private room
   临时工作目录           临时工作目录

一句话原则：

Obsidian 是纸面系统，orchestrator 是考务系统，agent workspace 是考场房间。

⸻

4. 各部分职责

Obsidian

负责：

- 存放每轮答卷
- 存放用户主题
- 存放 synthesis
- 存放 recap
- 作为人类查看、编辑、同步、归档的界面

不负责：

- 调度模型
- 控制上下文隔离
- 管理并发
- 直接作为 agent 的共享工作区

Orchestrator

负责：

- 创建 session / turn
- 生成 Round 1 prompt
- 给每个 agent 分配独立 workspace
- 调用 Claude Code / Codex CLI
- 收集 Round 1 答卷
- 匿名化答卷
- 生成 Round 2 prompt
- 再次调用每个 agent
- 生成最终 synthesis
- 生成 recap
- 写入 Obsidian Vault

Agent Workspace

负责：

- 给每个 agent 一个隔离运行目录
- 避免 agent 读到其他 agent 的答卷
- 避免读取 Obsidian vault 或当前项目目录造成上下文污染


⸻

5. 为什么不让 agent 直接在 Obsidian 里答题

可以做，但不推荐。

如果 Claude Code / Codex 直接在同一个 vault 里运行，它们可能读到：

- 其他 agent 的答卷
- 历史讨论
- 未完成的半成品
- Obsidian 里的其他笔记
- 项目里的 CLAUDE.md / 配置 / 上下文文件

这样第一轮就不是真正的独立脑暴了。

所以更稳的方式是：

agent 在 private workspace 里答题
orchestrator 收卷
收卷后写入 Obsidian


⸻

6. 推荐目录结构

Orchestrator 工作目录

brainstormd/
  adapters/
    claude_code.py
    codex.py
    openrouter.py
    ollama.py
  prompts/
    round1.md
    round2.md
    synthesis.md
    recap.md
  private-workspaces/
    session-id/
      turn-001/
        claude/
        codex/
        deepseek/
  runs/
  db.sqlite

Obsidian Vault 目录

Brainstorm/
  sessions/
    2026-04-24_多模型盲评脑暴系统/
      index.md
      _config.md
      turns/
        turn-001/
          user.md
          round-1/
            agent-a_claude.md
            agent-b_codex.md
            agent-c_deepseek.md
          round-2/
            agent-a_claude.md
            agent-b_codex.md
            agent-c_deepseek.md
          synthesis.md
          recap.md
          metadata.json
        turn-002/
          user.md
          round-1/
          round-2/
          synthesis.md
          recap.md


⸻

7. 每个 turn 的流程

1. user 写入本轮主题
2. orchestrator 读取当前 session recap
3. 生成 Round 1 prompt
4. 并发或半并发调用各 agent
5. 每个 agent 只看到：
   - user message
   - session recap
   - 自己的 role prompt
6. 收集 Round 1 答案
7. 写入 Obsidian
8. 匿名化 Round 1 答案
9. 生成 Round 2 prompt
10. 每个 agent 看到所有 Round 1 答案后再回答
11. 收集 Round 2 答案
12. 写入 Obsidian
13. 生成 synthesis
14. 生成 recap
15. recap 作为下一 turn 的上下文


⸻

8. 上下文控制原则

第一轮：

system prompt
+ session recap
+ user message
+ agent role prompt

第二轮：

system prompt
+ session recap
+ user message
+ 匿名化后的 Round 1 所有答卷
+ agent role prompt

下一轮：

只继承 updated session recap

不建议继承完整聊天历史，也不建议依赖 Claude Code / Codex 自己的 continue / resume 能力。

原因是：

上下文控制权应该在 orchestrator 手里，而不是在各个 CLI agent 手里。

⸻

9. CLI Adapter 方案

因为 Claude Code 和 Codex 走订阅 CLI，所以要把它们包装成 adapter。

抽象结构：

BaseModelAdapter
  ├── ClaudeCodeAdapter
  ├── CodexAdapter
  ├── APIModelAdapter
  └── LocalModelAdapter

Claude Code

大致调用方式：

claude -p "$PROMPT" \
  --output-format json \
  --no-session-persistence

注意点：

- 尽量使用非交互模式
- 不要复用 Claude 自己的 session
- 不默认使用 --bare，避免绕过订阅登录状态

Codex

大致调用方式：

cat prompt.txt | codex exec - \
  --skip-git-repo-check \
  --sandbox read-only \
  --ask-for-approval never \
  --output-last-message /tmp/codex-out.md

注意点：

- prompt 长时走 stdin
- sandbox 尽量 read-only
- approval 设为 never，避免卡住
- 用 output-last-message 拿最终回复


⸻

10. 状态机设计

每个 turn 可以有明确状态：

created
round_1_running
round_1_submitted
round_2_running
round_2_submitted
synthesized
recapped
closed

写文件时建议：

先写 .tmp
写完后 atomic rename

避免 Obsidian 或后续流程读到半截文件。

⸻

11. 匿名化与防偏见

第二轮不要让模型看到：

Claude 说：
Codex 说：
Gemini 说：

而是看到：

回复 A：
回复 B：
回复 C：

并且可以对每个 agent 随机打乱顺序。

这样可以减少模型因为品牌、模型名、先后顺序造成的偏见。

⸻

12. Agent 角色设计

比起简单堆多个模型，更有价值的是给它们不同角色：

发散型 agent：尽量提出更多方案
批判型 agent：专门找漏洞和风险
落地型 agent：关注工程实现、成本和复杂度
用户视角 agent：关注可用性、表达和体验
裁判 / synthesis agent：只负责最终汇总，不参与前两轮

这样多模型脑暴的价值会更稳定。

⸻

13. Obsidian 的使用方式

Obsidian 可以作为：

- 答题纸
- 阅卷室
- session dashboard
- recap 编辑器
- 历史脑暴归档
- 多设备阅读同步

但不建议作为：

- agent 运行目录
- agent 共享上下文目录
- agent 之间交换信息的实时通道

Obsidian Sync 可以用，但它适合做：

人类阅读端同步

不适合做：

agent 执行协调机制


⸻

14. 第一版 MVP 建议

先不要做复杂 Web UI。

第一版可以是一个本地 CLI：

brainstorm new "如何设计多模型盲评脑暴系统"

运行后生成 Obsidian 文件：

round-1/
  claude.md
  codex.md
  deepseek.md

round-2/
  claude.md
  codex.md
  deepseek.md

synthesis.md
recap.md

下一轮：

brainstorm continue path/to/session

或者从 Obsidian 的 next.md / user.md 里读取下一轮输入。

⸻

15. 最小技术栈

第一版：

Python
subprocess
Markdown files
SQLite 可选
Obsidian Vault
Claude Code CLI
Codex CLI
一个 API 模型或本地模型可选

暂时不需要：

PostgreSQL
Web UI
复杂权限系统
LangGraph
完整数据库 schema

等 MVP 验证有价值后，再升级成：

FastAPI / Flask
SQLAlchemy
React UI
PostgreSQL
任务队列
模型调用历史和成本统计


⸻

16. 最终方案一句话

最终我们讨论出的设计是：

建一个本地 brainstormd：它像考务系统一样给每个模型发卷，每个模型在独立 private workspace 里答题；交卷后，系统把答卷写入 Obsidian；第二轮再把匿名化后的所有答卷发给每个模型批阅；最后生成 synthesis 和 recap，recap 作为下一轮上下文。Obsidian 只作为答题纸、档案库和人类阅读界面，不作为 agent 的共享工作区。