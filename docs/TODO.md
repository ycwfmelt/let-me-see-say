# TODO

延期项。当前 scope 不做但要留在视野里。

## 协议层已留槽位，等实现

- [ ] **Role 卡 / 角色化 prompt**
  - 槽位：`Participant` 接口有 `role` 字段预留；prompt 模板有 `{{role_section}}` 注入位
  - 触发：Web UI 提供 role 选择 UI；或在 agent profile 里配置
  - 价值：draft-A §12 提到的"发散 / 批判 / 落地 / 用户视角"——尤其"用户视角"那个故意唱反调的角色，纯靠模型默认倾向不会有人主动承担
  - 详见 ADR-004

- [ ] **Human participant 实现**
  - 槽位：协议层（branch / 文件结构 / task.md / status）对 human 完全适用，无需协议变更
  - Web UI 已提供基础设施（SSE 实时更新、outcome 编辑器），需要增加：task.md 展示 → 人在 UI 输入答案 → 写文件 + commit 的流程
  - 形态：参考"狼人杀"——human 每轮拿到一个明确的 task.md → web UI 展示给人 → 人在 UI 里输入答案 → web UI 写文件 + commit
  - 详见 ADR-005

## 等需求触发

- [ ] **LLM 起草 outcome**
  - 当前：`draftOutcome` 写一个空 stub（`kind: ?` + `Decision / Direction: ...`）+ 嵌入 review materials，人在 Web UI 表单里填决定区
  - 升级：调 LLM（Anthropic API 直调最简单）读所有 round-1 + round-2 内容，自动起草决定区，人编辑修订
  - 模板和 strip 逻辑都已就绪；只需在 `draftOutcome` 里加 LLM 调用

- [ ] **SQLite session 元数据**
  - 当前：扫 `private-workspaces` 目录 + 读 session.json manifest
  - 触发：session 数量多时需要快速列表、按 status filter、搜索等

- [ ] **MCP server**
  - 当前：纯文件协议
  - 触发：文件协议端到端跑顺（已经跑顺了 ✓），把"工具调用"层抽成 MCP（join_room / get_my_task / submit_answer / get_round-1-pool / get_outcome），agent 改用 MCP tool 替代直接读写文件

- [ ] **更多 agent provider**
  - OpenRouter / Ollama / 其他
  - Agent profile schema 已支持任意 `cli` + `flags` + `env`，所以是写 wrapper / 加 example profile 的工作，不是协议变更

- [x] **Artifact 多形态（HTML 原型）** — ADR-007, issue #9
  - session 级 `outputMode`（`md-only` | `md-and-artifact`）控制是否产出 artifact
  - 单文件 HTML+CSS+JS 原型，路径 `turn-N/<name>/artifact.html` / `artifact-r2.html`
  - Web UI 用 sandboxed iframe 预览，支持查看源码
  - 后续可扩展支持更多 artifact 类型（图表、Mermaid 等）

- [ ] **Codex trust 通过 config.toml 预登记（替代 post_start_keys）**
  - 当前 MVP：`agents.toml` 里 `post_start_keys = [""]`，每个 session spawn 时自动按 Enter 接受 trust prompt
  - 替代方案：在 `~/.codex/config.toml` 写 `[projects."<worktree-abs-path>"] trust_level = "trusted"`，永久 trust 该路径，spawn 时不再有 prompt
  - 取舍：config 持久但每 session 都加一条 entry 会污染全局 config；keypress 路径短期更干净。先维持现状，看是否有人觉得 keypress 不可靠再切

## 可观测性 / 健壮性

- [ ] **Session purge / cleanup**
  - 当前：失败的 session 要手动 `rm -rf` vault session 目录 + 本地 worktree + 杀残留 tmux
  - 加 Web UI 上的 Purge 按钮：删 vault session 目录 + worktree + 杀 tmux session
  - 注意：操作在 finalize 之外的 session 上要警告（数据可能未归档）

- [ ] **Agent 卡住的检测与恢复**
  - 当前：Web UI 提供实时 pane 查看 + Cancel 按钮 + Resume 恢复
  - 后续：自动检测卡住（pane 长时间无输出变化）、自动重启 / 降级

- [ ] **TUI ready 主动 sniff**
  - 当前：固定 `bootSettleSeconds=8` + `postStartDelay=4`
  - 升级：`tmux capture-pane` 看 pane content，匹配各 CLI 的 "ready" 字样（claude 的输入框 / codex 的 "Booting MCP" 完成等）后再发 wake-key
  - 好处：消除时序假设，处理 cold start 慢的情况

- [ ] **长 session 的 auto-compaction 处理**
  - Claude Code TUI 长会话自动压缩 context，>10 turn 可能丢上下文
  - 后续：显式 checkpoint，把关键状态从 agent context 持久到 task.md / outcome 系列文件
