# TODO

延期项。当前 scope 不做但要留在视野里。

## 协议层已留槽位，等实现

- [ ] **Role 卡 / 角色化 prompt**
  - 槽位：`Participant` 数据有 `role: Optional[str]` 字段；prompt 模板有 `{{role_section}}` 注入位
  - 触发：web UI 提供 role 选择 UI；或 CLI 用户在 agent profile 里手填
  - 价值：draft-A §12 提到的"发散 / 批判 / 落地 / 用户视角"——尤其"用户视角"那个故意唱反调的角色，纯靠模型默认倾向不会有人主动承担
  - 详见 ADR-004

- [ ] **Human participant 实现**
  - 槽位：协议层（branch / 文件结构 / task.md / status）对 human 完全适用，已经设计成 web UI 来时无需协议变更
  - 触发：web UI 上线
  - 形态：参考"狼人杀"——human 每轮拿到一个明确的 task.md → web UI 展示给人 → 人在 UI 里输入答案 → web UI 写文件 + commit
  - 详见 ADR-005

## 等需求触发

- [ ] **SQLite session 元数据**
  - 当前 MVP：扫 vault 目录够用
  - 触发：web UI 需要快速列 session、按 status filter 等

- [ ] **MCP server**
  - 当前：纯文件协议
  - 触发：文件协议端到端跑顺、机制验证完成后，把"工具调用"层抽成 MCP（join_room / get_my_task / submit_answer / get_round-1-pool / get_outcome），agent 改用 MCP tool 替代直接读写文件

- [ ] **更多 agent provider**
  - OpenRouter / Ollama / 其他
  - Agent profile schema 已支持任意 `cli` + `flags` + `env`，所以是写 wrapper / 加 example profile 的工作，不是协议变更

- [ ] **Artifact 多形态**
  - 协议层目录结构 `turn-N/<participant>/` 已支持任意文件类型
  - MVP 只处理 markdown；UX 设计类主题用 HTML mockup、图表、草图等等都还不行

## 可观测性 / 健壮性

- [ ] **Agent 卡住的检测与恢复**
  - MVP 靠人 `tmux attach <session-name>` 看 + `brainstorm cancel <session>` 兜底
  - 后续：超时检测、自动重启 / 降级、卡死 LLM 调用的 timeout

- [ ] **长 session 的 auto-compaction 处理**
  - Claude Code TUI 长会话自动压缩 context，>10 turn 可能丢上下文
  - 后续：显式 checkpoint，把关键状态从 agent context 持久到 task.md / outcome 系列文件
