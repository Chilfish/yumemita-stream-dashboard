# 文档索引

本目录记录数据台的结构、数据口径、开发约定与部署方式。改代码或加数据前，先读对应的文档。

| 文档 | 内容 | 什么时候读 |
| --- | --- | --- |
| [architecture.md](architecture.md) | 分层、数据流、路由、状态管理、图表策略、扩展点 | 想改页面结构或加新视图 |
| [data-model.md](data-model.md) | manifest / datapack 的字段、口径、版本演进 | 读写 JSON、排查数据问题 |
| [adding-data.md](adding-data.md) | 加场次、加成员、加数据集、数据校验 | 数据有更新 |
| [data-progress.md](data-progress.md) | 频道历史抓取进度、跳过判定、下一批候选 | 继续补历史场次 |
| [development.md](development.md) | 本地开发、代码规范、coss ui、D3 图表写法、测试 | 日常开发 |
| [deployment.md](deployment.md) | 构建、静态托管、子路径、缓存、CI | 上线 |
| [troubleshooting.md](troubleshooting.md) | 常见报错与数据异常 | 页面空白 / 图表为空 |
| [ui-refactor.md](ui-refactor.md) | 信息架构、设计系统、coss ui 落地映射、迁移计划 | 规划界面重构 |
| [product-direction.md](product-direction.md) | 封面图管线、相册、逐字稿、组级页面、推文联动与阶段计划 | 规划下一轮产品迭代 |
| [roadmap.md](roadmap.md) | 后续数据与功能计划 | 规划迭代 |

## 约定

- 文档用简体中文；字段名、命令、代码保持原文。
- 时间一律 **JST（UTC+9）**。
- 数据（manifest / insights / datapack）在对象存储；git 里只有 `data-sources.json`。`data/` 与 `public/data/` 分别是本地暂存与构建生成物。
- 改数据结构时，同时更新 `src/types/`、`docs/data-model.md`、`docs/adding-data.md`。
- `src/components/ui/` 是 coss ui 的生成文件，升级用 CLI，不手写业务逻辑。
