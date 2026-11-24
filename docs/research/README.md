# 调研（Research）

本目录存放与具体实现解耦的通用问题调研：外部资料、现象分析、机制解释与可迁移的做法。项目内的执行规范仍放在 `engineering/`、`ui-design/` 与 `planning/`。

## 索引

| 文档 | 说明 | 日期 |
| --- | --- | --- |
| [ai-generated-ui-density.md](./ai-generated-ui-density.md) | AI 生成界面为什么倾向堆信息、加脚注与重复入口；外部观察、机制与规避方法 | 2026-11-07 |
| [agents-md-structure.md](./agents-md-structure.md) | AGENTS.md / CLAUDE.md 的合理长度与结构；渐进披露、维护规则与外部依据 | 2026-11-07 |
| [long-transcript-rendering.md](./long-transcript-rendering.md) | 长逐字稿的滚动卡顿与闪烁；中日附录按语言挂载、`backdrop-filter` 缺陷与 `content-visibility` 取舍 | 2026-11-09 |
| [long-document-rendering-practices.md](./long-document-rendering-practices.md) | 业界如何处理超长文档 / 列表：SSR、content-visibility、虚拟化、渐进渲染、Canvas 与内容折叠的取舍 | 2026-11-09 |
| [seo-audit-2026-11-15.md](./seo-audit-2026-11-15.md) | 用 claude-seo 对线上站点做的一次完整 SEO 审计：工具评估、发现分级与修复顺序 | 2026-11-15 |
| [ssr-html-classname-weight.md](./ssr-html-classname-weight.md) | SSR HTML 里 Tailwind 类名到底占多少：四个页面的实测、压缩后的边际成本、业内六类做法与本站模拟收益 | 2026-11-15 |
| [danmaku-viewer-design.md](./danmaku-viewer-design.md) | 弹幕查看器调研：现有 InnerTube 采集、记录格式、平台限制与量级；新项目的数据结构、存储选型（SQLite / Neon）、写入路径与四种展示形态 | 2026-11-24 |

## 约定

- 区分「外部观察」与「本仓库结论」；引用给出来源与日期。
- 调研不替代规范：可执行规则写进对应规范文档，并在报告里链接。
- 结论带适用边界；不把从业者经验写成受控实验。
- 外部链接失效时保留标题与出处，不直接删除段落。
- 根指令文件的取舍与维护规则见 [agents-md-structure.md](./agents-md-structure.md)。
