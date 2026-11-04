# 常见问题

## 页面空白 / 一直显示错误

1. 先确认 Worker 能连数据库：

   ```bash
   bun run db:query
   ```

2. 看 Worker 日志里的 `x-request-id` 与 `x-response-time`；`DATABASE_URL` 缺失时页面应显示错误态而不是白屏。
3. 确认 `DATABASE_URL` 只配在服务端（`.dev.vars` / `wrangler secret`），没有进入客户端 bundle。
4. 硬刷新（Ctrl/Cmd + Shift + R）排除旧缓存。

## “数据库里没有可用的 dataset”

- `data-sources.json` 为空或 `id` 不合法。
- 还没跑 `bun run db:ingest`：`datasets` / `streams` 为空。
- 新增成员后忘了 ingest：`bun run db:ingest --dataset <id>`。

## “找不到这场直播”（404）

- 该 `videoId` 还没 ingest：`bun run db:ingest --dataset <id>`。
- `datasetId` / `videoId` 拼错；`.md` 路由的 `.md` 后缀由路由处理，不要写进参数。
- 未知单场返回真 404，且 `no-store`，不会长期缓存。

## 封面 / 表情 404

- `PUBLIC_R2_BASE` 未配置或配错（桶 / 前缀 / 自定义域名），浏览器会回退到 `/data/...`，而该目录已删除。
- 该场还没有 `fetch:thumbs` / `publish:assets`：跑对应脚本后补传。
- R2 公开域名只用于封面与表情；逐字稿正文走 `/api/transcripts/...`，不从这里读。

## 图表是空的

- **该场没有 VSTATS**：`vstats: null`，同接/视聴时间相关图表会跳过。会员限定场常见。
- **没有 SC**：币种环图显示“本 dataset 没有 SC 记录”。
- **没有评论**：评论区显示空状态；`comments` 可能为 `null`。
- **词频/发言者为空**：datapack 的 `topWords` / `topAuthors` 是 Top 截断列表，场次太短可能不足阈值。
- **趋势页仍显示“榜单相加”**：说明该 dataset 还有 v1 datapack；用 `stream-datapack.ts` 重建为 v2 后重跑 `db:ingest`。只重建了一部分时 `dataset_insights.aggregation` 为 `partial`，页面会显示精确覆盖的场次数；全部重建后才变成 `full`。

## 更新日历是空的

- `streams.date` / `started_at` 缺失的场次不会进日历。
- 日历按 **JST 自然日**聚合：同一天多场只算一格；切到「场次」指标时显示 1–2 是正常的。
- 热力图在窄屏横向滚动，需要左右滑动才能看到更早的月份。

## CI / 部署报缺少变量

- `DATABASE_URL`、`PURGE_TOKEN`：仓库 Secrets（数据工作流），以及 `wrangler secret put`（Worker 运行时）。
- `PUBLIC_R2_BASE`、`SITE_URL`：仓库 Variables；`PUBLIC_R2_BASE` 在构建时内联，改了要重新部署。
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`：部署工作流。
- 本地用 `.env` 或 `.dev.vars`；不要提交真实凭据。

## 数字看起来不对

先确认口径（见 [data-model.md](../data/data-model.md)）：

- 播放/点赞有 **VSTATS 快照** 和 **yt-dlp 抓取时点** 两套值，差值方向不固定。
- 币种金额不换算汇率，不能直接相加。
- 全月词频/发言者是“各场 Top 列表相加”，不是全量重扫。
- 评论数是抓取上限内的条数，不是视频总评论数。
- 纯表情条目计入 `chat.total`，但不算正文。

## 类型检查报错

- `astro check` 暂不支持 TypeScript 7；仓库锁定 `typescript@6`，不要单独升级。
- 路径别名只写在 `tsconfig.json` 的 `paths`：

  ```json
  "paths": { "@/*": ["./src/*"] }
  ```

- `verbatimModuleSyntax` 开启：类型导入要写 `import type`。
- `noUnusedLocals` / `noUnusedParameters` 开启：删掉未使用的变量/参数。

## 构建报 CSS / 字体错误

- 本项目用 `@fontsource-variable/noto-sans` 与 `@fontsource-variable/noto-sans-sc`，在 `src/styles/app.css` 顶部导入。
- `src/styles/app.css` 的 `@import`（字体、Tailwind）必须排在其他规则之前。
- coss ui 的 token 在 `app.css` 的 `@theme inline` / `:root` / `.dark` 里；不要删。

## 开发端口被占用

```bash
bun run dev -- --port 4322
```

## 新增 coss 组件后类型报错

- 先看该组件的 `references/primitives/<name>.md` 组合方式；`Select` / `Dialog` / `Menu` 等 trigger 结构不能照搬 Radix。
- 用 `--dry-run` / `--diff` 预览覆盖范围：

  ```bash
  bunx --bun shadcn@latest add @coss/select --dry-run
  ```

- 生成文件里的未使用 import 可能导致 `noUnusedLocals` 报错；可以删掉未使用的组件，或按 CLI 版本重新生成。

## 对比页最多只能选 4 场

这是产品限制（`MAX_COMPARE = 4`，在 `src/lib/routes.ts`），避免逐分钟叠加图过密。需要更多时改常量，并考虑图例/颜色的可读性。

## 分享的链接打开后不是原来的页面

- 路由是真实路径：完整链接为 `https://example.com/nonoka/stream/<videoId>`。旧版本的 `#/...` 链接会在应用启动前自动改写成真实路径。
- 静态托管必须配置 SPA 回退（`vercel.json` 已带），否则直接刷新深链会 404。
- 链接里的 `videoId` 或 `datasetId` 不存在时会重定向/提示：dataset 不合法回到首个数据集；场次不存在显示「找不到这场直播」并标 `noindex`。
- 旧版本没有路由，之前的页面链接（只有根路径）会回到组首页，这是预期行为。
- 切换数据集时只会保留当前 section（单场会回到该数据集最新一场），不会保留原来的 `videoId`。

## 分享卡片没有标题或封面

- 单场 head 由 SSR 在请求期输出；新场次 ingest 后立即可用，不需要额外构建。
- 检查 `SITE_URL` / `astro.config.mjs` 的 `site`：canonical / `og:url` / `og:image` 需要绝对地址。
- canonical 一直停在旧域名：`astro.config.mjs` 优先读 `process.env.SITE_URL`，本机 shell 残留同名变量会覆盖 `.env`；用 `SITE_URL=https://ymmt.chilfish.top bun run cf:deploy` 显式传一次再验证。
- `og:image` 走 `PUBLIC_R2_BASE/<dataset>/thumbs/<videoId>.jpg`；确认 R2 公开域名可访问。
- 用 `curl -s <单场 URL> | grep -E '<title>|canonical|og:image'` 确认请求期 head 正常输出。

## 封面不显示

- 先确认本地有图：`data/<datasetId>/thumbs/<videoId>.jpg`；没有就 `bun run fetch:thumbs --dataset <id>`。
- 生产读的是 `PUBLIC_R2_BASE/<dataset>/thumbs/<videoId>.jpg`，需要 `publish:assets` 上传；只跑 `fetch:thumbs` 不会出现在线上。
- 图存在但显示成员色兜底：确认 `PUBLIC_R2_BASE` 指向 `yumemita-data` 的公开域名（对象在桶根，不再有公共前缀），以及对象是否公开可读。
- 相册里个别卡片是兜底：说明那场没有 `video.thumbnail` 或下载失败，可加 `--force` 重抓。

## 逐字稿不出现

- 单场页的「逐字稿」分段只在索引里有该 `videoId` 时出现；先 `bun run publish:transcripts --no-upload` 看校验是否通过。
- 本地开发会回退到构建期快照，但新增文件需要 Vite 重新加载（保存一次或重启 dev）。
- 线上还看不到：检查 `<base>/transcripts/index.json` 是否已更新；发布时索引最后写，失败会保留旧索引。
- `videoId` 写错不会拦发布，但会和场次对不上；用 `transcript:new` / `transcript:import` 从 manifest 匹配可避免。

## 数据更新后页面还是旧的

- 页面有 60–300 秒的 Workers Cache；等 TTL 过去或按 tag purge。
- 改了本地 pack 后忘了 `bun run db:ingest`，数据库仍是旧值。
- 缓存未失效：跑 `bun run purge:cache --dataset <id>`；Workers Cache 需要 TTL 或 purge 才会更新。
- 增量发布没传某个 pack：进度记在 `data/.publish-state.json`（上次上传的内容摘要 + 字节数）。远端对象被删、大小对不上会自动重传；怀疑进度记录有问题时用 `bun run publish:assets --force` 全量重传。
- 本地 `astro dev` 会热更新；如果是 `preview`，重新 `bun run build && bun run preview`。
