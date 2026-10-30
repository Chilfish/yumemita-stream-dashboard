# 常见问题

## 页面空白 / 一直显示加载

1. 配了 `VITE_DATAPACK_BASE` 时，先确认对象存储根目录有 `index.json`：

   ```bash
   bun run validate:data -- --remote
   ```

   没有就先跑 `bun run publish:data`。

2. 浏览器 Network 面板看 `<base>/index.json` 是否 404；远端不可达时页面会回退到同源 `data/index.json`，本地快照可用 `bun run sync:data` 生成。
3. 如果部署在子路径，确认 `vite.config.ts` 的 `base` 与访问路径一致。
4. 硬刷新（Ctrl/Cmd + Shift + R）排除旧缓存。

## “index.json 里没有可用的 dataset”

- `data-sources.json` 为空或 `id` 不合法。
- 远端 `index.json` 是旧版本或不存在：重新跑 `bun run publish:data`。
- 离线开发时先跑 `bun run publish:data --no-upload` 生成 manifest，再 `bun run sync:data` 生成本地索引。

## “datapack 加载失败（HTTP 404）”

- 对象存储上缺这个 videoId：发布没跑完，或漏传。
- `VITE_DATAPACK_BASE` 配错（桶不对、路径多了层级），或桶的 CORS 没放行站点源。
- manifest 与 pack 不一致：manifest 由 `publish:data` 派生，不要手改。

```bash
bun run publish:data               # 重新派生并上传
bun run validate:data -- --remote  # 逐条 HEAD 确认可达
```

## 图表是空的

- **该场没有 VSTATS**：`vstats: null`，同接/视聴时间相关图表会跳过。会员限定场常见。
- **没有 SC**：币种环图显示“本 dataset 没有 SC 记录”。
- **没有评论**：评论区显示空状态；`comments` 可能为 `null`。
- **词频/发言者为空**：datapack 的 `topWords` / `topAuthors` 是 Top 截断列表，场次太短可能不足阈值。
- **趋势页仍显示“榜单相加”**：说明该 dataset 还有 v1 datapack；用 `stream-datapack.ts` 重建为 v2 后重跑 `publish:data`。只重建了一部分时 `insights.totals.aggregation` 为 `partial`，页面会显示精确覆盖的场次数；全部重建后才变成 `full`。

## 更新日历是空的

- manifest 里 `date` / `startedAt` 缺失的场次不会进日历。
- 日历按 **JST 自然日**聚合：同一天多场只算一格；切到「场次」指标时显示 1–2 是正常的。
- 热力图在窄屏横向滚动，需要左右滑动才能看到更早的月份。

## CI 报缺少 VITE_DATAPACK_BASE

- 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 添加 `VITE_DATAPACK_BASE`，值为公开数据根地址。
- 本地跑 CI 时用 `.env` 或 shell 环境变量；如果对象存储在桶内前缀下，地址要带同一前缀（例如 `https://example.com/stream-dashboard`）。
- 地址变更后重新构建，`VITE_DATAPACK_BASE` 会在构建时内联进产物。

## 数字看起来不对

先确认口径（见 [data-model.md](data-model.md)）：

- 播放/点赞有 **VSTATS 快照** 和 **yt-dlp 抓取时点** 两套值，差值方向不固定。
- 币种金额不换算汇率，不能直接相加。
- 全月词频/发言者是“各场 Top 列表相加”，不是全量重扫。
- 评论数是抓取上限内的条数，不是视频总评论数。
- 纯表情条目计入 `chat.total`，但不算正文。

## 类型检查报错

- TypeScript 7 移除了 `baseUrl`；路径别名只写在 `paths`：

  ```json
  "paths": { "@/*": ["./src/*"] }
  ```

- `verbatimModuleSyntax` 开启：类型导入要写 `import type`。
- `noUnusedLocals` / `noUnusedParameters` 开启：删掉未使用的变量/参数。

## 构建报 CSS / 字体错误

- 本项目用 `@fontsource-variable/inter` 与 `@fontsource-variable/geist-mono`，不要 import `geist`（那是 Next.js 专用包）。
- `src/index.css` 的 `@import` 必须排在 Tailwind 之后、其他规则之前。
- coss ui 的 token 在 `index.css` 的 `@theme inline` / `:root` / `.dark` 里；不要删。

## 开发端口被占用

```bash
bunx vite --port 5174
# 或
bun run dev -- --port 5174
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

- 静态 head 由 `scripts/generate-seo.ts` 在构建时写入 `dist/<path>/index.html`；新发布的场次要等下一次构建才有静态卡片，客户端 meta 已是最新。
- 检查 `VITE_SITE_URL` 是否设置：canonical / `og:url` / `og:image` 需要绝对地址。
- 用单场封面作 `og:image` 时，对象存储需要允许跨域读取或至少允许直接访问；`og:image` 走的是 `<dataset>/thumbs/<videoId>.jpg`。
- 托管商若没有把目录索引当成文件（`/nonoka` → `/nonoka/index.html`），会命中 SPA 回退，静态 head 不生效；查看页面源代码确认 `<title>`。
- `bun run verify:seo` 会检查 sitemap 条数、canonical、`og:image` 与 robots。

## 封面不显示

- 先确认本地有图：`data/<datasetId>/thumbs/<videoId>.jpg`；没有就 `bun run fetch:thumbs --dataset <id>`。
- 生产读的是 `<base>/<dataset>/thumbs/<videoId>.jpg`，需要 `publish:data` 上传；只跑 `fetch:thumbs` 不会出现在线上。
- 图存在但显示成员色兜底：检查 `VITE_DATAPACK_BASE` 是否包含桶内前缀（`R2_PREFIX`），以及对象是否公开可读。
- 相册里个别卡片是兜底：说明那场没有 `video.thumbnail` 或下载失败，可加 `--force` 重抓。

## 逐字稿不出现

- 单场页的「逐字稿」分段只在索引里有该 `videoId` 时出现；先 `bun run publish:transcripts --no-upload` 看校验是否通过。
- 本地开发会回退到构建期快照，但新增文件需要 Vite 重新加载（保存一次或重启 dev）。
- 线上还看不到：检查 `<base>/transcripts/index.json` 是否已更新；发布时索引最后写，失败会保留旧索引。
- `videoId` 写错不会拦发布，但会和场次对不上；用 `transcript:new` / `transcript:import` 从 manifest 匹配可避免。

## 数据更新后页面还是旧的

- 发布后缓存：`data/*.json` 在 `vercel.json` 里是 300s 短缓存，对象存储侧的 manifest/insights 也是短缓存，等一会儿或强制刷新。
- 改了本地 pack 后忘了 `bun run publish:data`，远端仍是旧索引。
- 增量发布没传某个 pack：进度记在 `data/.publish-state.json`（上次上传的内容摘要 + 字节数）。远端对象被删、大小对不上会自动重传；怀疑进度记录有问题（例如手工改过桶里的文件）时用 `bun run publish:data --force` 全量重传。
- 本地开发 Vite 会热更新；如果是 `preview`，重新 `bun run build && bun run preview`。
