# 开发日志（Development Log）

按天记录开发过程。每天一个文件 `YYYY-MM-DD.md`，新日期在前。

> 跨天的工作拆到不同文件；同一天多条记录用 `##` 分节。开发中发现的 Bug 模式同步到 [postmortem](../postmortem/README.md) 索引。

## 记录约定

- 文件名 `YYYY-MM-DD.md`，首行 `# YYYY-MM-DD`。
- 一天内多条变更用 `## 主题` 分节，按时间顺序排列。
- 每节写清：做了什么、为什么这样做、验证命令与结果、踩到的坑、未完成项。
- 决策链接到 ADR / postmortem / review；实现链接到 commit hash。
- 不写流水账，不把计划写成已完成；未完成项放 [backlog](../planning/backlog.md) 或阶段方案。
- 文档与界面文案按 [writing-style.md](../writing-style.md)。

## 索引

| 日期 | 主题 | 状态 |
| --- | --- | --- |
| 2026-11-04 | 阶段 5：数据库差集、资产 / 逐字稿链路、客户端媒体清理与部署配置 | ✅ |
| 2026-11-03 | 文档体系重组；Astro + PostgreSQL 迁移方案 | ✅ |
