# 性能优化：剩余项

> **状态**：2026-11-05 审计的 P0 大部分已落地。本文只保留尚未执行的优化项；已完成项的 before / after 见 [performance.md](../engineering/performance.md) 与 git 历史。
> **已完成**：逐字稿 DEV 守卫、列表窄列、对比页密度 API、单场页取数收敛、搜索防抖、`DatasetViewContext` memo、图表 hover 节流、命令面板按需加载、图表占位。
> **当前基线**：客户端 JS 1.52 → 0.98 MB，单场页 HTML 696 → 281 KB，对比页 3 场 9 → 4 SQL。

## 1. props 收敛（P0）

成员列表页仍把该成员全部场次作为 `rows` 序列化进 HTML，首屏只渲染 100 行；单场页也复用同一份列表。对比页仍把完整 pack 作为 props。

| 优化 | 位置 | 预期 |
| --- | --- | --- |
| `rows` 按路由裁剪字段，或首屏只传 100 行 + 极简索引，其余走 `/api/streams` 分页 | `src/db/queries/view-data.ts`、列表 / 单场页 | 成员页 HTML 从数百 KB 量级继续下降 |
| 对比页只传 `density.perMinute` | `src/db/queries/packs.ts`、`compare-view.tsx` | 去掉整份 pack 的序列化 |
| Astro props 去重 | 页面 → 岛屿 | 避免 `dataset` / `datasets`、`stream` / `rows` 同项写两遍 |

## 2. 壳层重构与按视图拆包（P1）

当前每个页面只有一个大岛屿，静态引入全部视图；`React.lazy` 会让 SSR 输出 fallback，必须先做壳层拆分。

- 把侧栏 / 页头移出 React 岛屿，改成 Astro 布局 + `transition:persist`。
- 正文用 `server:defer` 流式输出。
- 壳层稳定后，再按 `view` 拆分岛屿或 `React.lazy`，让每个路由只加载自己的视图。
- 命令面板保持打开时才挂载。

## 3. ingest / publish 批量化（P1）

| 优化 | 位置 | 说明 |
| --- | --- | --- |
| ingest 批量化 | `scripts/ingest-db.ts` | 多 pack 一个事务、多行 insert、`ON CONFLICT DO UPDATE` 取代逐场 delete + insert |
| insights 增量 | `scripts/ingest-db.ts` | 只重算变化场次，或「上一份 + 差量」 |
| publish 增量 | `scripts/publish-data.ts` | mtime + size 预筛；`--assets-only` 不再全量 `readPacks` / stringify |
| daily-update 合并 | `scripts/daily-update.ts` | 5 段 `runScript` 合并为一次进程内调用 |

## 4. 其他待评估项（P1–P2）

- `.md` 只取 `density` / `coveragePct`，pack 查询与 R2 读并行；pack 子表加 limit。
- `llms.txt` 用窗口函数取每成员前 20，避免全表标题。
- `datasets` 统计改读 ingest 预聚合的 `stream_count` / `generated_at`。
- 补 `.md` 锁定版 / 404 与 `/api/transcripts` 404 的 `cache.set` 与负缓存。
- 索引调整：删不用的 `stream_authors_author_idx`、`stream_words_word_idx`，补 `streams(started_at desc)`。
- Worker 读连接加 statement timeout。
- 稳定 `useKeyboardShortcuts` 监听器、预计算排序日期、删除隐藏端重复列表。
- 评论 / SC / 对比勾选列表加 `content-visibility:auto` 或复用 `VirtualList`。
- 客户端持久缓存：逐字稿、pack、表情索引走 sessionStorage + SWR + 请求去重。
- 让 HTML 与 query 解耦（岛屿挂载后读 `location.search`），收敛缓存条目。
- `cross_version_cache: true` + 部署后按 `astro-version` tag purge。
- 把 `/compare` 桶与首页 summary 落库，请求期不再全表扫 + 逐行 `classifyTitle`。
- 删死代码：`ui/calendar.tsx` + `@daypicker/react`、未使用的字体依赖、`stream_details.raw_detail` 死列、`compare` 死 tag、未引用 `ui/*`。
- 清理 `public/data/` 的构建拷贝；头像补 `width` / `height` / `decoding="async"`。
- 修正 `groupComments` 的 `!item.byUploader || true` 残留逻辑。

## 5. 执行顺序

1. props 收敛：先减少 HTML 与传输量，风险最低。
2. 壳层重构：侧栏 / 页头移出岛屿，再按视图拆包与流式输出。
3. 管线批量化：ingest + publish 增量，先保证读侧稳定。
4. 结构性项：query 解耦、跨版本缓存，等前三步数字出来后再评估。

## 6. 验证

每一步按 [performance.md](../engineering/performance.md) 记录 before / after：

```bash
bun run check
bun run build
bun run db:bench -- --rounds 20 --label after
bun run perf:smoke -- --url http://127.0.0.1:8787
bun run test:smoke
```

前端改动额外用生产构建 + `wrangler dev` 记录 HTML 体积、chunk 体积、LCP / INP 与长任务；只在 `astro preview` 下测的数字不算。

## 7. 未验证

- 没有跑 Lighthouse / Performance 面板，交互热点按代码路径与渲染频率推断。
- 体积收益多为估算，实施前先录一次长任务基线。
- 没有验证 Cloudflare 静态资源上传是否按内容哈希增量。
- 没有审计第三方脚本、R2 CORS 与缓存规则的实际命中率。
