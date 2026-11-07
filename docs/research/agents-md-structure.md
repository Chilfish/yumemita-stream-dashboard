# AGENTS.md 的结构与长度

调研日期：2026-11-07（JST）。范围：AGENTS.md / CLAUDE.md 的官方说明、维护者经验与公开分析。目的是给本仓库确定一个可维护的根指令文件形态。

## 摘要

- AGENTS.md 是 Agent 的 README，不是项目手册。它默认进入每次会话，长度直接占用指令预算。
- 常见建议是 30 到 100 行；Anthropic 对 CLAUDE.md 的建议是不超过 200 行；Codex 在累计 32 KiB 时停止加载。
- 根文件只保留：一句话项目说明、验证命令、少量硬约束、到详细文档的链接。
- 领域规则、多步流程、文件地图与完整反模式表放在 `docs/` 或 skills，按需读取。

## 1. 为什么不能一直加

- **每行都进入每次请求**：与当前任务无关的规则也会消耗上下文，并降低整体遵循率。
- **指令预算有限**：维护者经验值约 150 到 200 条指令；Agent 的系统提示本身已经占用一部分。
- **路径会漂移**：文件地图和目录树最容易过期，过期内容会主动误导 Agent。
- **重复与矛盾更糟**：同一规则出现两次只是浪费；两条规则互相矛盾时，模型可能任选一条。

维护者的共识是：根文件写「每次任务都成立、且 Agent 无法从代码推断」的内容。其余信息用链接暴露，等任务需要时再读。

## 2. 外部资料

### 2.1 Anthropic：CLAUDE.md 控制在 200 行内

Anthropic 的记忆文档建议：

> target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence.

同一页还建议把只与部分代码相关的规则移到 path-scoped rules，把多步流程移到 skills。导入文件能改善组织，但不会减少上下文，因为被导入的文件会一起加载。([Claude Code memory](https://code.claude.com/docs/en/memory))

### 2.2 HumanLayer：根文件少于 60 行

HumanLayer 的经验是根 `CLAUDE.md` 少于 60 行，并给出三条与长度直接相关的判断：

- 指令越多，遵循质量整体下降，不只是忽略后面的条目。
- 只放对当前任务普遍适用的内容；领域细节会分散模型注意力。
- 用指针代替副本；代码片段容易过期，指向权威文件更稳。
- 不要让 LLM 充当 linter；格式与静态检查交给确定性工具。

他们把这种做法称为渐进披露：根文件只给地图，详细说明放在按需读取的 Markdown 文件里。([Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md))

### 2.3 aihero：最小根文件只需要三件事

Matt Pocock 的建议更激进：根 `AGENTS.md` 只需一句话项目说明、包管理器（如果不是 npm）与非标准构建命令，其他内容全部移走。

他还提醒不要记录文件结构，因为路径变化很快；描述能力与领域概念比描述目录更稳定。([A Complete Guide To AGENTS.md](https://www.aihero.dev/a-complete-guide-to-agents-md))

### 2.4 betterclaw：100 行目标与规则生命周期

BetterClaw 汇总了多个来源的长度口径：

- 目标少于 100 行，150 行开始删除，200 行是 Anthropic 的实际上限。
- 多数好文件在 30 到 80 行。
- 文件过长的信号：解释技术选型历史、包含目录树或依赖列表、包含多步流程、存在互相矛盾的规则、记不清一半规则为什么存在。

它还给出规则的生命周期：Agent 同类错误出现第二次才加规则；模型升级后能自己做对就删除；每季度审一次。([AGENTS.md Best Practices](https://www.betterclaw.io/blog/agents-md-best-practices))

### 2.5 agents.md：Agent 的 README

agents.md 官方站点把 AGENTS.md 定义为「给 Agent 的 README」，与人类 README 分工：README 负责快速开始与贡献指南，AGENTS.md 负责构建步骤、测试与约定。

推荐章节是项目概览、构建与测试命令、代码风格、测试说明与安全注意事项。([agents.md](https://agents.md))

### 2.6 GitHub：2,500 多个仓库的共同点

GitHub 对 2,500 多个 agents.md 文件的分析发现，表现较好的文件通常具备：

- 命令放在前面，带完整参数。
- 用一个真实代码片段展示风格，而不是三段描述。
- 明确边界：哪些文件、目录与操作不能碰。
- 技术栈写具体版本，不写「React 项目」。
- 覆盖命令、测试、项目结构、代码风格、Git 流程与边界六个区域。

这篇分析主要针对自定义 Agent 人设，但「具体、可执行、有边界」同样适用于根指令文件。([GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/))

### 2.7 一个需要保留的边界

有预印本认为上下文文件总体不一定提升任务成功率，却平均增加推理成本。这个结论有适用边界：文件写得具体、可执行时，Agent 确实会遵循；写得泛泛时，增加的主要是成本。

对本仓库的含义：根文件只留下真正会改变行为的约束，不抄写模型已经知道的通用建议。

## 3. 本仓库的取舍

根 `AGENTS.md` 控制在 60 行左右，只保留六块：

| 区块 | 内容 |
| --- | --- |
| 项目一句话 | 栈、数据来源、部署形态 |
| 先读哪里 | 6 个最常用入口，完整索引交给 `docs/README.md` |
| 强制规范 | 每次任务都成立的 8 条 |
| 不可协商的技术约束 | 数据边界、三态、Token、导航、密钥 |
| 工作流 | 读文档 → 登记 → 实现 → 验证 → 复盘 |
| 维护本文件 | 只写通用约束、细节外链、去重与去矛盾 |

搬出去的内容：

| 内容 | 新位置 |
| --- | --- |
| 任务意图 → 文件 | [docs/engineering/code-map.md](../engineering/code-map.md) |
| 架构、数据流、路由、目录 | [docs/planning/architecture.md](../planning/architecture.md) |
| 代码风格与禁止事项 | [docs/engineering/code-style.md](../engineering/code-style.md) |
| UI、信息密度 | [docs/ui-design/README.md](../ui-design/README.md) |
| 基线雷区与反模式 | [docs/postmortem/README.md](../postmortem/README.md) |
| 发布与本地开发 | [release-checklist.md](../engineering/release-checklist.md)、[development.md](../engineering/development.md) |

## 4. 维护规则

1. 只写每次任务都成立、且 Agent 无法从代码或 docs 推断的约束。
2. 同一规则只留一处；发现矛盾先修，再谈新增。
3. Agent 同类错误出现第二次才加规则；模型能自己做对后删除。
4. 多步流程、目录树、依赖清单与完整反模式表不回到根文件。
5. 关键规则用 hook、脚本或 CI 强制执行；AGENTS.md 只负责说明。
6. 每季度审一次；改约定时在同一个 PR 更新。
7. 新增内容前先问：它属于根文件、领域文档，还是 skill。

## 参考

| 来源 | 用途 |
| --- | --- |
| [Claude Code memory](https://code.claude.com/docs/en/memory) | 200 行建议、path-scoped rules、skills |
| [Writing a good CLAUDE.md — HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md) | 60 行根文件、指令预算、渐进披露 |
| [A Complete Guide To AGENTS.md — aihero](https://www.aihero.dev/a-complete-guide-to-agents-md) | 最小根文件、不要记录文件结构 |
| [AGENTS.md Best Practices — BetterClaw](https://www.betterclaw.io/blog/agents-md-best-practices) | 长度口径、过长信号、规则生命周期 |
| [agents.md](https://agents.md) | 官方定位与推荐章节 |
| [How to write a great agents.md — GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/) | 2,500 多个仓库的共同点 |
