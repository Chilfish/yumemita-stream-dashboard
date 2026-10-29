# 部署

## 构建

```bash
bun install --frozen-lockfile
bun run build
```

产物：

```text
dist/
├─ index.html
├─ assets/        # JS/CSS/字体（带 hash）
└─ data/          # index.json + <dataset>/manifest.json + insights.json
```

`dist/` 是纯静态文件，不需要 Node 运行时。逐场 datapack 不在 `dist/` 里，由浏览器向对象存储请求。

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
| 环境变量 | `VITE_DATAPACK_BASE` — 数据根地址（manifest / insights / datapack） |

`VITE_DATAPACK_BASE` 在构建时被 Vite 内联进产物，改动后需要重新构建。留空则回退到本地 `data/` 暂存区。

这些平台通常支持 Bun；如果没有，用 `npm install && npm run build` 也可以（脚本内部调用 `vite`）。

### 单页应用回退

不需要。项目使用 **hash 路由**（`#/:datasetId/...`），所有页面都由 `index.html` 加载，路径不会出现在 HTTP 请求里。

- 不需要配置 `/* -> /index.html` 的 rewrite。
- 子路径部署（`https://example.com/dashboard/`）也直接可用，hash 不参与 base 解析。

## 数据发布与对象存储

所有数据（manifest / insights / datapack）都在 Cloudflare R2（或任意 S3 兼容存储）上，git 里只有代码与 `data-sources.json`。

```text
<bucket>/
└─ stream-dashboard/        # R2_PREFIX：桶内前缀，留空则直接写桶根
   └─ nonoka/
      ├─ manifest.json
      ├─ insights.json
      └─ <videoId>.datapack.json
```

### 发布

```bash
# 需要 R2_* 凭据与可选的 R2_PREFIX（桶内前缀，见 .env.example），只在本地跑
bun run publish:data

# 只重算本地 manifest/insights，不上传
bun run publish:data --no-upload
```

`publish:data` 以本地 `data/<id>/*.datapack.json` 为唯一真源：先上传全部 pack，再上传 manifest 与 insights。中途失败只会多出一个未被引用的 pack，不会出现指向不存在文件的索引。

### 构建

- 构建只需要 `VITE_DATAPACK_BASE`（公开根地址，例如 `https://pub-xxxx.r2.dev`），不需要写权限凭据。用了 `R2_PREFIX` 时，这里也要带上同一前缀（如 `https://example.com/stream-dashboard`）。
- `sync:data` 从该地址拉 `manifest.json` 与 `insights.json`，缓存到 `node_modules/.cache/stream-dashboard/`；拉取失败时回退缓存，无缓存则构建失败。
- 浏览器直接请求 `<base>/<datasetId>/<videoId>.datapack.json`。

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
- manifest / insights 用短缓存（60 秒左右），发布后尽快生效。
- 发布后跑 `bun run validate:data -- --remote` 逐条 HEAD，确认地址可达。

## 缓存策略

- `assets/*` 带 content hash，可以长缓存（`Cache-Control: public, max-age=31536000, immutable`）。
- `data/*.json`（索引与预聚合）用短缓存：`public, max-age=300, must-revalidate`，避免数据更新后看到旧值。
- `index.html` 用 `no-cache`。
- 仓库自带 `vercel.json` 已按上述规则配置；datapack 的缓存由对象存储侧控制。

## CI

仓库自带 `.github/workflows/ci.yml`：

```text
checkout → setup Bun → bun install → sync:data → validate:data
        → typecheck → test → lint → build
```

本地同款：

```bash
bun run ci
```

## 数据与隐私

- 部署前确认 `data/` 里没有会员限定/会限等不适合公开的内容。
- `data/` 会原样进入 `dist/data/`，对访问者可见；不要放 cookie、邮箱、付款信息等隐私数据。
- 如需只公开部分场次，做法是**只把可公开的 datapack 放进 `data/<dataset>/`**，而不是在前端做隐藏（前端隐藏不等于不可访问）。

## 体积

- 首屏数据是 `index.json` + `manifest.json` + `insights.json`：262 场时约 400 KB，gzip 后约 47 KB。
- `dist/data/` 只含这三个文件，datapack 不在构建产物里。
- 262 份 datapack 合计约 7 MB，放在对象存储；单场页只取 1 份，对比页最多 4 份。
- JS 主包约 349 KB（gzip ~112 KB），CSS 约 240 KB（gzip ~32 KB）。
- 视图已按路由 `React.lazy()` 拆包，总览/单场/对比/数据表/说明各自是独立 chunk。

## 回滚

静态站点回滚 = 重新部署上一版 `dist/`。数据回滚 = 恢复 `data/` 的上一版提交并重新构建。两者都在 Git 历史里。
