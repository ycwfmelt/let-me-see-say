# let-me-see-say

本地多模型脑暴 orchestrator。多个 participant（CLI agent，未来还有 human）就一个主题在多个 turn 里层层深入；每 turn 内分两 round（独立 + 收敛），turn 末尾产出 outcome 作为下一 turn 的种子。

## 这是干什么的

你想脑暴一个主题（"多模型脑暴系统怎么设计"、"这个 UX 流程要怎么改"），但身边没合适的人。这个工具开 session，让多个 LLM agent（claude-sonnet、qwen、glm 等）独立给观点 → 互相 anonymized 看到对方再收敛 → 每轮你在 Web UI 里确认 outcome 进下一轮深入。

整个过程**只用订阅 CLI**（claude / codex），不烧 API token；agent 的对话上下文由 TUI 自身保留，跨 turn 不丢。也支持通过 env 注入自定义 API base URL 使用代理模型。

## 文档

- [docs/design.md](docs/design.md) · 当前架构活文档
- [docs/decisions.md](docs/decisions.md) · ADR 决策日志
- [docs/TODO.md](docs/TODO.md) · 延期项
- [docs/drafts/](docs/drafts/) · 历史脑暴草稿
- [examples/](examples/) · 端到端跑通过的真实 session 归档（含每轮答卷 + outcome）
- [CLAUDE.md](CLAUDE.md) · 在本仓库工作的硬约束

## 用法

需要本机已安装 `tmux`、`git`、[Bun](https://bun.sh/)、以及订阅版 `claude` / `codex` CLI。

```bash
# 安装依赖
bun install

# 第一次跑前：拷一份 agent 配置（agents.toml 已 gitignored；改成你自己的 profile）
cp agents.toml.example agents.toml

# 启动 Web UI
bun dev
```

打开 `http://localhost:3000`，通过浏览器操作：

1. **New Session** — 填写 topic（支持 Markdown）、选择 vault 路径、勾选参与的 agent profile
2. **实时监控** — 每个 agent 的 tmux pane 输出通过 SSE 实时推送到浏览器
3. **编辑 Outcome** — Round 1 + Round 2 完成后，在表单里选择 outcome 类型、填写决策方向，参考右侧 participant 提交内容
4. **Advance / Finalize** — 推进到下一 turn 或结束 session（merge 所有 participant 分支到 main）
5. **Resume** — 如果 session 中断（服务重启、agent 超时等），可以从中断处恢复

Agent profiles 在 `agents.toml`——同一个 CLI 不同 model / 不同 API base 是不同 participant。示例：

```toml
[agents.claude-sonnet]
cli = "claude"
flags = ["--model", "sonnet"]

[agents.qwen3-plus]
cli = "claude"
flags = ["--effort", "max"]
env = { ANTHROPIC_BASE_URL = "https://your-proxy.example.com", ANTHROPIC_AUTH_TOKEN = "sk-...", ANTHROPIC_MODEL = "qwen3.6-plus" }
```

## 技术栈

- **Runtime / 包管理**: Bun
- **Framework**: Next.js (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Testing**: Vitest (`bun test`)

## 测试

```bash
bun test          # 运行全部 86 个测试
bun test:watch    # watch 模式
```

## License

TBD
