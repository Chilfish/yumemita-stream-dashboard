# Changelog

## 未发布

### 数据

- `nonoka` 分两批从最近 30 场向前续抓 18 场（2026-06-22 – 2026-08-09，以及 2024-12-13 的存档），共 **48 场**。
- 新增 [docs/data-progress.md](docs/data-progress.md)：频道历史抓取进度、跳过判定、下一批候选。

### 界面

- 首页重排为四层：页面头 → 规模指标条 → 最近一场 / 本月 / 全期记录 → 最近场次 → 更新日历。
  规模指标从页头的一组小字提为 24px 数字条；最近一场只保留 3 个主指标，其余降为一行次级读数。
- 内容构成、全期高频词/发言者、典型节奏曲线移到趋势页；首页不再与趋势页重复堆叠分析块。
- 修复横向溢出：`SidebarInset` 是 `w-full` 的 flex item，自动最小宽度把它撑到内容固有宽度；
  图表 SVG 的测量宽度也会回灌父级 min-content。现在主列加 `min-w-0`，图表容器用
  `contain: inline-size` 隔离。
- 更新日历渲染后自动滚到最近月份，首屏先看到近期活跃度。
- 新增 `--text-stat`（24/30，600）字阶，用于规模指标与最近一场主指标。

### 工程

- **数据源迁到对象存储**：manifest / insights / datapack 全部放 R2，git 里只保留 `data-sources.json`。
- 新增 `bun run publish:data`：以本地 pack 为唯一真源，派生 manifest + insights 后先传 pack、再传索引，
  避免索引指向不存在的文件；`--no-upload` 可只生成本地文件。
- `sync:data` 改为构建时从 `VITE_DATAPACK_BASE` 拉 manifest/insights，带 `node_modules/.cache` 缓存兜底；
  没配地址时回退本地 `data/` 暂存区。
- `validate:data --remote` 逐条 HEAD 校验对象存储上的 manifest / insights / datapack。
- 新增 `vercel.json`（缓存头）与 `.env.example`。
- `publish:data` 支持 `R2_PREFIX`：对象写进桶内指定前缀，`VITE_DATAPACK_BASE` 指向同一前缀。
- 上传改用 Bun 原生 `S3Client`，移除 `aws4fetch` 依赖。
- 移除 GitHub Pages 部署 workflow（`.github/workflows/deploy.yml`），部署迁到 Vercel。
- 修复：`data/.gitignore` 的全忽略规则导致 232 份 datapack 从未被提交，远端构建缺数据。

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
