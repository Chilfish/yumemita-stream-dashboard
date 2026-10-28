# Changelog

## 未发布

### 数据

- `nonoka` 分两批从最近 30 场向前续抓 18 场（2026-06-22 – 2026-08-09，以及 2024-12-13 的存档），共 **48 场**。
- 新增 [docs/data-progress.md](docs/data-progress.md)：频道历史抓取进度、跳过判定、下一批候选。

### 工程

- `scripts/stream-datapack.ts` 接入 `data-sources.json`：按 `channel_id` 匹配 dataset，直接写
  `data/<id>/<videoId>.datapack.json` 并 upsert manifest；支持一次传入多个会话目录。
- manifest 摘要抽到 `scripts/lib/dataset-manifest.ts`，与 `add-datapack.mjs` 共用。

## 0.1.0 — 2026-10-28

首个可用版本。

### 数据

- 内置 `nonoka`（宮永ののか）最近 30 场直播的归一化 datapack（2026-08-10 – 2026-10-22）。
- `data/` 作为源数据随仓库提交；`public/data/` 由 `sync:data` 生成。
- 提供 `add:datapack` / `validate:data` 脚本。

### 页面

- 总览：KPI、每场同接、SC 币种构成、弹幕浓度散点、全月高频词/发言者、最近场次。
- 单场：逐分钟弹幕 + SC、每 10 分钟分布、SC 全表、Top 词/发言者、徽章、评论区。
- 对比：最多 4 场，逐分钟叠加 + 指标对比表。
- 数据表：搜索、排序、仅有 VSTATS 筛选、CSV 导出。
- 说明：口径、限制、更新方式。
- 深浅色主题、响应式布局、多 dataset 选择器。

### 工程

- React 19 + Vite + TypeScript + Tailwind CSS v4 + coss ui + D3。
- Vitest 单元测试（格式化、聚合）。
- oxlint、`bun run check` / `bun run ci`。
- GitHub Actions CI。
- 文档：架构、数据模型、加数据、开发、部署、排错、路线图。
