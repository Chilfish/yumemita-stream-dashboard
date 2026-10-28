# 常见问题

## 页面空白 / 一直显示加载

1. 确认 `public/data/index.json` 存在：

   ```bash
   bun run sync:data
   ls public/data
   ```

2. 浏览器 Network 面板看 `data/index.json` 是否 404。
3. 如果部署在子路径，确认 `vite.config.ts` 的 `base` 与访问路径一致。
4. 硬刷新（Ctrl/Cmd + Shift + R）排除旧缓存。

## “index.json 里没有可用的 dataset”

- `data-sources.json` 为空或 `id` 不合法。
- 配了 `VITE_DATAPACK_BASE` 时检查 `<base>/<id>/manifest.json` 是否存在；没配时先跑 `bun run publish:data --no-upload` 生成本地文件。
- `sync:data` 的输出会写每个 dataset 的场次数。

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

- 路由是 hash 形式：完整链接必须带上 `#`，例如 `https://example.com/repo/#/nonoka/stream/<videoId>`。
- 链接里的 `videoId` 或 `datasetId` 不存在时会重定向/提示：dataset 不合法回到首个数据集；场次不存在显示「找不到这场直播」。
- 旧版本没有路由，之前的页面链接（只有根路径）会回到总览，这是预期行为。
- 切换数据集时只会保留当前 section（单场会回到该数据集最新一场），不会保留原来的 `videoId`。

## 数据更新后页面还是旧的

- 发布后缓存：`data/*.json` 在 `vercel.json` 里是 300s 短缓存，对象存储侧的 manifest/insights 也是短缓存，等一会儿或强制刷新。
- 改了本地 pack 后忘了 `bun run publish:data`，远端仍是旧索引。
- 本地开发 Vite 会热更新；如果是 `preview`，重新 `bun run build && bun run preview`。
