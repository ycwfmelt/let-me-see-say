# Turn 1 · Round 1 — claude-sonnet

## 核心问题拆解

用户想要的系统有三个关键属性：
1. **多模型并行**：多个 LLM 同时参与同一话题
2. **Round 1 互盲**：第一轮各自独立，互不可见
3. **Round 2 收敛**：看到所有人的 Round 1 后再各自更新观点

这是一个**编排（orchestration）问题**，不是模型能力问题。模型本身无需特殊能力，隔离靠编排层强制执行。

---

## 现有产品扫描

**最接近但不完全匹配的：**

- **ChatHub / Poe**：浏览器侧并排显示多模型输出，但是同步触发后各自显示，没有"Round 2 看完再回"的机制，也没有 turn 结构
- **Perplexity**：多源聚合但单模型推理
- **CrewAI / AutoGen / LangGraph**：多智能体框架，支持 agent 间通信，但默认 agent 之间可以互相看（collaborative），没有 blind-round 的原生设计
- **Camel**：角色扮演型多 agent，同样不强制隔离

**结论：没有现成产品直接实现这个 blind-parallel-then-converge 的流程。** 需要自己搭，但工程量不大。

---

## 推荐实现方案

### 编排策略

**核心原则：隔离由编排层保证，模型无需知道彼此存在。**

Round 1 触发时，每个模型只收到 topic（和上一 turn 的 outcome）。编排器负责：
- 并行发送请求 / 触发 agent
- 收集所有 Round 1 答案
- 匿名化聚合（Reply A / Reply B / ...）
- 将聚合结果注入 Round 2 上下文

### 实现路径 A：API 直调（最简单）

```
orchestrator.py
  → asyncio.gather(call_claude(), call_gpt(), call_gemini(), ...)  # Round 1
  → aggregate & anonymize
  → asyncio.gather(call_claude(pool), call_gpt(pool), ...)        # Round 2
  → human review → outcome → next turn
```

优点：逻辑清晰，代码量小，容易测试  
缺点：每 turn 重新建对话，模型没有跨 turn 的 context window（每次都是无状态 API 调用）

### 实现路径 B：长生 CLI Agent + tmux（适合需要 context 连续性）

每个 participant 是一个持久运行的 CLI agent（如 `claude` 交互式会话），跑在独立 tmux pane 里。编排器通过 `tmux send-keys` 投递 task，agent 读 task 文件、写答案文件、git commit 作为 done 信号。

优点：agent 跨 turn 保留 context window，"记得"自己之前说过什么  
缺点：工程复杂度高，需要管理 tmux session、git worktree、done 信号检测

**隔离机制**：每个 agent 写自己专属路径（`turn-N/<agent>/answer.md`），编排器控制信息流——Round 1 期间不向任何 agent 透露其他人的输出。

### 实现路径 C：混合

对"需要跨 turn 积累观点"的核心 agent 用路径 B，对无状态辅助角色用路径 A。

---

## 关于 turn recap 的设计

Turn recap（`outcome.md`）是整个系统的关键杠杆：
- 它是人类（或 orchestrator + 人类协作）对本 turn 的提炼
- 下一 turn 的种子，决定对话深度的递进方向
- 不是简单的摘要，而是"下一步要追问什么"

建议 outcome 格式：`**结论**` + `**分歧点**` + `**下一 turn 追问方向**`，强迫每 turn 向前走，而不是原地打转。

---

## 我的建议

如果只是验证想法：**路径 A（API 直调）** 先跑通流程，一个下午可以有可用版本。

如果想要 agent 有真实的"跨 turn 记忆"和沉浸感：**路径 B（tmux + git）**，工程量约 1-2 周，但体验更接近"真实参与者"而不是无状态 API。

两者的 Round 1 互盲机制实现方式完全相同：编排器控制信息流，模型自己不需要做任何特殊处理。
