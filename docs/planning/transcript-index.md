# 逐字稿索引：检索、分面与长列表

> 状态：✅ 已实现（2026-11-07）。
> 相关代码：`src/components/dashboard/transcript/transcripts-view.tsx`、`src/components/dashboard/transcript/transcripts-toolbar.tsx`、
> `src/components/pages/transcripts-page.tsx`、`src/lib/transcripts.ts`、`src/lib/transcript-params.ts`。

## 当前实现

- `src/lib/transcript-params.ts`：`q` / `tags` / `sort` / `dense` 的解析、写入与筛选计数，URL 只保存非默认值。
- `src/lib/transcripts.ts`：搜索分词、标签分面、排序、摘要截取与高亮切分；配 `src/lib/*.test.ts`。
- `src/components/dashboard/transcript/transcripts-toolbar.tsx`：搜索框与单一「筛选」入口；桌面 Popover、移动端底部 Sheet。
- `src/components/dashboard/transcript/transcripts-view.tsx`：月份分组、逐组 disclosure、扁平搜索结果、命中高亮。
- `src/pages/[datasetId]/transcripts.astro` 与数据库查询不变，仍是请求期 SSR 传完整索引。

## 背景

逐字稿索引页当前由 SSR 查询 `transcripts` 表，把全部 `TranscriptIndexEntry` 传给岛屿，
`TranscriptsView` 按月份分组后一次性渲染。2026-11-07 的本地稿件量：

| 成员 | 篇数 |
| --- | ---: |
| nonoka | 82 |
| yuno | 29 |
| miyako | 18 |
| arale | 14 |
| ritsu | 6 |
| 合计 | 151 |

字段只有 `date` / `title` / `summary` / `tags` / `updatedAt`。这个体量下全量渲染不是瓶颈；
真正的体验问题是缺少检索入口、长列表没有方向感、行信息密度对几百篇不友好。

## 目标

1. 在不动 SSR 与数据库查询的前提下，让 100–1000 篇的索引仍然可查找、可浏览。
2. 桌面与移动端共用同一份数据与交互语义，移动端不靠横向滚动表格硬塞。
3. 不改逐字稿正文与发布链路。

## 非目标

- 不做分页、无限滚动、虚拟列表。当前量级收益低，还会破坏「按月份浏览」和浏览器内查找。
- 不做服务端搜索接口。等单成员稳定超过约 1000 篇，再评估 `/api/transcripts?q=`。
- 不做阅读进度、收藏、用户系统。

## 交互

### 1. 工具栏

| 控件 | 行为 | URL |
| --- | --- | --- |
| 搜索 | 匹配标题、摘要、标签、日期、`videoId`；空格分词后要求全部命中 | `q` |
| 标签 | 多选，要求同时包含所选标签；显示篇数 | `tags`（逗号分隔） |
| 排序 | 最新 / 最早 / 标题 | `sort` |
| 密度 | 舒适 / 紧凑 | `dense=1` |

- 标签、排序与密度收进同一个「筛选」入口：桌面弹层，移动端底部面板。
- 搜索输入即时过滤，写 URL 延迟 200ms，使用 `replace` 不污染历史记录。
- 页头事实在筛选时显示「N 篇匹配」，没有结果时给出「清除筛选」。
- 桌面端工具栏不吸顶；移动端搜索行与筛选按钮吸顶在应用顶栏下方（`top-12`）。

### 2. 月份分组

- 月份只通过分组标题表达，不再做侧边年月索引或顶部月份 chips。
- 分组标题在桌面端吸顶，滚动时自然承担位置提示；移动端标题随内容滚动，避免与吸顶工具栏叠层。
- 分组默认折叠状态由每条标题右侧的 disclosure 控制。
- 搜索或标签筛选时切换为扁平结果列表，不显示月份分组。

### 3. 月份折叠

- 默认展开所有月份；分组标题只负责定位，收起由用户主动触发。
- 不做「全部展开 / 全部收起」：逐组 disclosure 已经够用，全局按钮会增加工具栏重量。
- 折叠月份不渲染行，减少 DOM；展开分组使用 `content-visibility: auto`。
- 标题排序与筛选结果使用扁平列表，不参与折叠。

### 4. 行结构

- 舒适：日期列 + 标题 + 最多两行摘要 + 标签。
- 紧凑：日期列 + 标题 + 标签，不显示摘要。
- 标签只作为灰色元信息文本，不做成行内按钮；筛选统一走工具栏的「筛选」入口。
- 搜索命中词用 `<mark>` 高亮；摘要截取命中附近片段。

### 5. 不做最近更新

- 不做「最近更新」独立区块：按最新排序时首屏已经是最近内容，再放一条只增加重复和视觉重量。
- `updatedAt` 仍保留在数据里，留给以后真正需要「新入库」提示时再用。

## 移动端

- 工具栏吸顶区域只保留搜索框与「筛选」按钮；筛选面板从底部弹出。
- 触控目标不小于 44px；标签在面板内换行，不做横向滚动。
- 320px 宽度下不出现横向溢出；底部留出标签栏与安全区。
- 月份分组标题只在 `md` 以上吸顶，避免与移动端工具栏叠层。

## 性能

- 折叠状态只渲染展开的分组；搜索使用 `useDeferredValue`。
- 分组列表与单行使用 `content-visibility: auto` + `contain-intrinsic-size`。
- 仍由 SSR 传完整索引；不新增请求。索引字段保持窄列，不引入正文。
- 相关人数与篇数在客户端用纯函数计算，并配单元测试。

## 验收标准

- `AC-TRANSCRIPT-002`
  - 输入关键词后，标题、摘要、标签、日期或 `videoId` 命中的条目出现，未命中的消失；清空后恢复。
  - 选择两个标签时，只保留同时包含两个标签的条目。
  - 刷新带 `?q=&tags=&sort=&dense=1` 的地址，工具栏、结果与密度保持。
  - 移动端 390px 与 320px 下无横向溢出；筛选面板可完成标签、排序、密度与重置。
  - 默认展开所有月份；逐组 disclosure 可收起与再展开，收起后不渲染条目。
  - 搜索命中词有高亮；无结果时出现「清除筛选」。
  - `bun run test`、`bun run typecheck`、`bun run lint`、`bun run build` 通过。
  - 手工走查路径记录在 `docs/development-log/2026-11-07.md`。

## 验证

```bash
bun run test
bun run typecheck
bun run lint
bun run build
```

页面手工走查需要 `bun run dev` 或 `bun run preview`，并用 390px、320px 两个视口检查移动端。
