# 部署

## 构建

```bash
bun install --frozen-lockfile
bun run build
```

产物：

```text
dist/
├─ index.html              # 组首页（带静态 head）
├─ robots.txt
├─ sitemap.xml
├─ <datasetId>/index.html  # 成员首页与栏目页
├─ <datasetId>/stream/<videoId>/index.html   # 每个单场一份静态 head + noscript 摘要
├─ assets/                 # JS/CSS/字体（带 hash）
└─ data/                   # 兜底快照：index.json + <dataset>/manifest.json + insights.json
```

`generate-seo` 会为每个路由写一份 `dist/<path>/index.html`（约 1900 个），并生成 `sitemap.xml` / `robots.txt`。

`dist/` 是纯静态文件，不需要 Node 运行时。页面启动时直接向对象存储请求数据；`dist/data/` 只在远端不可达时兜底（例如离线预览）。逐场 datapack 不在 `dist/` 里。

## 本地预览

```bash
bun run preview
# 默认 http://localhost:4173
```

## 静态托管

### 子路径部署

如果站点不在域名根路径（例如 `https://example.com/dashboard/`），构建时设置 `VITE_BASE=/dashboard/`。
数据加载使用 `import.meta.env.BASE_URL`，会自动带上子路径，不需要改代码。

### Netlify / Vercel / Cloudflare Pages

| 项 | 值 |
| --- | --- |
| Build command | `bun run build` |
| Output directory | `dist` |
| Install command | `bun install --frozen-lockfile` |
| Node version | 22.22+ |
| 环境变量 | `VITE_DATAPACK_BASE` — 数据根地址（index / manifest / insights / datapack） |
| 环境变量 | `VITE_SITE_URL` — 站点根地址，用于 canonical / OG / sitemap；CI 里必须设置 |

`VITE_DATAPACK_BASE` 在构建时被 Vite 内联进产物，地址本身改动后需要重新构建；**数据更新不需要**，`bun run publish:data` 后刷新即可。留空则回退到本地 `data/` 暂存区。

这些平台通常支持 Bun；如果没有，用 `npm install && npm run build` 也可以（脚本内部调用 `vite`）。

### 单页应用回退

项目使用 **path 路由**，直接访问 `/nonoka/stream/<videoId>` 需要服务端在找不到文件时返回 `index.html`。仓库自带 `vercel.json`：

```json
"rewrites": [
  { "source": "/((?!assets/|data/|avatars/).*)", "destination": "/index.html" }
]
```

- Vercel 先查文件系统：`generate-seo` 生成的 `dist/<path>/index.html` 会优先命中，静态 head 生效。
- 排除 `assets/` / `data/` / `avatars/`，缺失的静态资源仍然返回 404，而不是伪装成 HTML。
- 其他静态托管需要等价配置：Netlify `_redirects` 里的 `/* /index.html 200`、Cloudflare Pages 的 SPA 规则。
- 子路径部署（`https://example.com/dashboard/`）用 `VITE_BASE=/dashboard/`；`basename` 与数据地址会自动带前缀，rewrite 也需要指向该子路径。

> 部署后确认一次：直接打开 `/nonoka`，查看源代码里的 `<title>` 是否为该成员页，而不是首页。若命中的是 SPA 回退，说明托管商没有把目录索引当成文件。

## 数据发布与对象存储

所有数据（index / manifest / insights / datapack）都在 Cloudflare R2（或任意 S3 兼容存储）上，git 里只有代码与 `data-sources.json`。

```text
<bucket>/
└─ stream-dashboard/        # R2_PREFIX：桶内前缀，留空则直接写桶根
   ├─ index.json            # dataset 索引（页面入口）
   ├─ transcripts/
   │  └─ index.json         # 逐字稿索引
   └─ nonoka/
      ├─ manifest.json
      ├─ insights.json
      ├─ <videoId>.datapack.json
      ├─ thumbs/
      │  ├─ <videoId>.jpg          # 原图 1280×720（srcset 的兜底 src）
      │  ├─ <videoId>.480.webp     # 列表 / 相册
      │  ├─ <videoId>.960.webp     # 首屏主图
      │  └─ <videoId>.1280.webp    # 高 DPI 主图
      └─ transcripts/<videoId>.json
```

### 发布

```bash
# 需要 R2_* 凭据与可选的 R2_PREFIX（桶内前缀，见 .env.example），只在本地跑
bun run publish:data

# 只重算本地 manifest/insights，不上传
bun run publish:data --no-upload

# 忽略本地进度，全量重传
bun run publish:data --force

# 封面：先镜像到本地，再由 publish:data 上传（已存在的跳过）
bun run fetch:thumbs --dataset nonoka
bun run publish:data --dataset nonoka

# 逐字稿：校验 / 增量上传
bun run publish:transcripts --no-upload
bun run publish:transcripts
```

`publish:data` 以本地 `data/<id>/*.datapack.json` 为唯一真源：先上传变化的封面与 pack，再上传 manifest 与 insights，最后写根目录的 `index.json`。中途失败只会多出一个未被引用的对象，不会出现指向不存在文件的索引。发布完成后页面刷新即生效，不需要重新构建。

逐字稿单独发布：`content/transcripts/` 是源文件，`publish:transcripts` 先传正文、最后写 `<base>/transcripts/index.json`，同样失败不阻塞。

增量上传的进度记在本地 `data/.publish-state.json`（不进 git）：

- 每个对象按 sha256 + 字节数记录；重跑时列一次桶，本地摘要没变、远端对象还在且大小一致就跳过。
- pack 变了、远端缺对象、远端大小对不上，都会重传。
- 列桶失败（凭据没有 ListBucket 权限 / 网络问题）时只按本地进度判断，并打印提示；要强制全量加 `--force`。
- 换桶或改 `R2_PREFIX` 后进度自动作废，重新全量传一次。
- manifest / insights 每次都重传（`generatedAt` 会变），只有 2 × dataset 数个小文件。

### 构建

- 构建只需要 `VITE_DATAPACK_BASE`（公开根地址，例如 `https://pub-xxxx.r2.dev`），不需要写权限凭据。用了 `R2_PREFIX` 时，这里也要带上同一前缀（如 `https://example.com/stream-dashboard`）。
- 页面运行时直接请求 `<base>/index.json`、`<base>/<datasetId>/manifest.json`、`insights.json` 与 `<base>/<datasetId>/<videoId>.datapack.json`。
- `sync:data` 从该地址拉 `index.json`、`manifest.json` 与 `insights.json`，缓存到 `node_modules/.cache/stream-dashboard/`，写进 `public/data/` 作为兜底快照；拉取失败时回退缓存，远端 index 不可用则按本地配置构造。

### CORS

用自定义域名或公开桶时，需要允许站点源 `GET` / `HEAD`：

```json
[
  {
    "AllowedOrigins": ["https://your-site.vercel.app"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

### 缓存

- datapack 内容随 videoId 固定，可以长缓存：`Cache-Control: public, max-age=31536000, immutable`。
- 逐字稿正文 key 带 videoId，但同一场会改稿，建议短缓存或发布时带 `updatedAt` 查询参数；索引本身同样是短缓存。
- `index.json` 每次启动带时间戳请求，CDN 缓存不影响新鲜度；manifest / insights 用索引的 `generatedAt` 作查询参数，发布后自动换 URL，可以放心短缓存或长缓存。
- 发布后跑 `bun run validate:data -- --remote` 逐条 HEAD（含根目录 `index.json`），确认地址可达。

#### 封面与变体

封面 key 只由 dataset + videoId（+ 宽度）决定，内容不可变，是最值得长缓存的一类对象。
注意：Bun 的 S3 写入只支持 `Content-Type`，**脚本无法给对象写 `Cache-Control`**（见
`scripts/lib/object-storage.ts` 的注释），所以缓存必须配在存储侧，而不是代码里。

推荐做法（Cloudflare R2）：

1. 给桶绑定**自定义域名**（如 `s3.example.com`），不要长期用 `pub-xxxx.r2.dev`：后者没有可配的缓存规则。
2. 该域名在 Cloudflare 上**开启代理**（橙色云），并用 **Cache Rule** 统一设置：
   - 表达式：`(http.request.uri.path contains "/thumbs/")`
   - Cache eligibility：`Eligible for cache`
   - Edge TTL：`Override origin` → `1 year`
   - Browser TTL：`Override origin` → `1 year`
3. 同一思路可选加到 datapack：`(http.request.uri.path ends_with ".datapack.json")`，同样 1 年。
4. `index.json` / `manifest.json` / `insights.json` 不要套长缓存：页面用时间戳 / `generatedAt` 参数保证新鲜度，
   让它们走默认（不缓存）最省心。
5. CORS 见上一节，需要允许 `GET` / `HEAD`。

换图注意：key 不变时会命中一年缓存。重新抓取或调整编码参数（宽度、quality）后，要么在 Cloudflare 上 purge
该前缀，要么改 key（例如把变体后缀升级成 `.v2.webp` 并同步 `src/lib/thumb-variants.ts`）。

## 缓存策略

- `assets/*` 带 content hash，可以长缓存（`Cache-Control: public, max-age=31536000, immutable`）。
- `data/*.json`（构建兜底快照）用短缓存：`public, max-age=300, must-revalidate`。
- `index.html` 用 `no-cache`；`generate-seo` 生成的嵌套 HTML 走托管商的 HTML 默认策略（`must-revalidate`），不需要额外规则。
- 运行时数据主要来自对象存储，其缓存由存储侧控制；仓库自带 `vercel.json` 只影响兜底快照。

## CI

仓库自带 `.github/workflows/ci.yml`。需要在 **Settings → Secrets and variables → Actions → Variables** 配置仓库变量 `VITE_DATAPACK_BASE`，指向公开数据根地址；缺失时 CI 会在 “Check datapack base” 步骤给出明确报错。

```text
checkout → setup Bun → bun install → check VITE_DATAPACK_BASE
        → sync:data（从对象存储拉 index/manifest/insights 作兜底）→ validate:data
        → typecheck → test → lint → build
```

本地同款（先在同一 shell 设置 `VITE_DATAPACK_BASE`，或使用 `.env`）：

```bash
bun run ci
```

## 数据与隐私

- `data/` 是本地暂存区，不进 git；`dist/data/` 只作为兜底快照。
- 公开范围由上传到对象存储的 datapack 决定；确认没有会员限定/会限等不适合公开的内容。
- 不要上传 cookie、邮箱、付款信息等隐私数据；前端隐藏不等于不可访问。

## 体积

- 首屏数据是根 `index.json` + 当前 dataset 的 `manifest.json` 与 `insights.json`；单个 dataset 约 300 场时约 400 KB，gzip 后约 47 KB。
- `dist/data/` 只含兜底快照，datapack 不在构建产物里。
- datapack 放在对象存储；单场页只取 1 份，对比页最多 4 份。
- JS 主包约 349 KB（gzip ~112 KB），CSS 约 240 KB（gzip ~32 KB）。
- 静态 SEO 页面约 1900 份（每份 4–8 KB，含 noscript 摘要），合计约 15 MB；不进入首屏 JS，也不影响运行时请求。
- 视图已按路由 `React.lazy()` 拆包，总览/单场/对比/数据表/说明各自是独立 chunk。

## 回滚

静态站点回滚 = 重新部署上一版 `dist/`。数据回滚 = 恢复对象存储的上一版对象（R2 版本控制 / 备份），或把本地暂存区的对应 pack 放回去重新 `bun run publish:data`；数据本身不在 Git 历史里。
