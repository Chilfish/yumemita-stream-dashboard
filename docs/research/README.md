# 调研（Research）

本目录存放与具体实现解耦的通用问题调研：外部资料、现象分析、机制解释与可迁移的做法。项目内的执行规范仍放在 `engineering/`、`ui-design/` 与 `planning/`。

## 索引

| 文档 | 说明 | 日期 |
| --- | --- | --- |
| [ai-generated-ui-density.md](./ai-generated-ui-density.md) | AI 生成界面为什么倾向堆信息、加脚注与重复入口；外部观察、机制与规避方法 | 2026-11-07 |
| [agents-md-structure.md](./agents-md-structure.md) | AGENTS.md / CLAUDE.md 的合理长度与结构；渐进披露、维护规则与外部依据 | 2026-11-07 |
| [long-transcript-rendering.md](./long-transcript-rendering.md) | 长逐字稿的滚动卡顿与闪烁；中日附录按语言挂载、`backdrop-filter` 缺陷与 `content-visibility` 取舍 | 2026-11-09 |
| [long-document-rendering-practices.md](./long-document-rendering-practices.md) | 业界如何处理超长文档 / 列表：SSR、content-visibility、虚拟化、渐进渲染、Canvas 与内容折叠的取舍 | 2026-11-09 |

## 约定

- 区分「外部观察」与「本仓库结论」；引用给出来源与日期。
- 调研不替代规范：可执行规则写进对应规范文档，并在报告里链接。
- 结论带适用边界；不把从业者经验写成受控实验。
- 外部链接失效时保留标题与出处，不直接删除段落。
- 根指令文件的取舍与维护规则见 [agents-md-structure.md](./agents-md-structure.md)。
