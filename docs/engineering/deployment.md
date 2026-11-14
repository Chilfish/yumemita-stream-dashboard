# 部署

> **当前形态（2026-11-04）**：Astro 7 SSR + `@astrojs/cloudflare`，部署到 Cloudflare Workers（`https://ymmt.chilfish.top`）。页面请求期查 Neon PostgreSQL；R2 只放封面、表情、原始 pack 归档与逐字稿正文。旧的静态托管、Vercel、`generate-seo`、`sync:data` 已删除。

## 构建与检查

```bash
bun install --frozen-lockfile
bun run check        # astro check + vitest + oxlint
bun run build        # dist/（Worker + 静态资源）
```

- `astro build` 只预渲染 `/404`、`/500`、`/:datasetId/about`；其他页面请求期渲染。
- 构建不需要数据库或 R2 凭据；只有部署后运行需要 Worker secrets。
- `PUBLIC_R2_BASE` 在构建期内联到客户端，用于封面 / 表情地址。

## 本地预览

```bash
bun run preview      # astro preview（workerd）
bun run cf:preview   # build + preview
```

- 开发环境 `Astro.cache.enabled === false`，缓存调用是 no-op；要验证缓存必须用生产构建或线上。
- `.dev.vars` 是唯一的环境文件：`DATABASE_URL` / `DATABASE_URL_ONLINE`、R2、`PUBLIC_R2_BASE`、`SITE_URL`、`PURGE_TOKEN`、管理端凭据。
- `astro preview` 下 R2 binding 不可用时，逐字稿 API 返回 503，客户端回退到本地 `content/transcripts/` 快照。
- `astro.config.mjs` 通过 `loadEnvFiles()` 读同一个文件；进程环境里的同名变量优先，临时切换用 `SITE_URL=… bun run cf:deploy`。

## 部署

```bash
bun run cf:deploy                         # 强制 LOCAL=0 → 构建 → 校验产物 → wrangler deploy
bun run cf:deploy -- --no-deploy          # 只构建并校验，不部署
bunx wrangler rollback                    # 回滚到上一版
```

- `cf:deploy` 固定按线上处理：强制 `LOCAL=0`、先清 `dist/` 再从零构建，构建后扫描产物，
  一旦出现本机媒体 / 代理地址就中止（`PROXY` 这类系统环境变量不算）。
- 必须用 `dist/server/wrangler.json` 部署：它由 adapter 生成，`main` 指向 `entry.mjs`、`assets` 指向 `../client`。根目录 `wrangler.jsonc` 只是源配置；直接 `wrangler deploy` 会把 `dist/server` 与 `.dev.vars` 当成静态资源上传。
- `.github/workflows/deploy.yml` 手动触发（`workflow_dispatch`）：`bun run ci` → `wrangler deploy --config dist/server/wrangler.json` → 线上路由冒烟。
- 需要仓库 Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；Variables：`PUBLIC_R2_BASE`、`SITE_URL`。
- Worker secrets（`wrangler secret put`）：`DATABASE_URL`、`PURGE_TOKEN`，以及日程管理端的账号 / 密码 / 会话密钥（见 `.dev.vars.example`）。
- `wrangler.jsonc` 声明 `nodejs_compat`、`ASSETS`、`R2` binding 与 Workers Cache（`cross_version_cache: false`）。
- `astro build` 与 `wrangler deploy` 不需要数据库；migration 在部署前单独执行。
- `SITE_URL` 决定 canonical / OG / sitemap / `.md` 链接的域名；切域名时改这个变量（或本地环境）后重新构建部署一次。

## 环境变量

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `DATABASE_URL` | Worker 读 + ingest 写 |
| Secret | `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | ingest / 资产发布（桶 `yumemita-data`） |
| Secret | `PURGE_TOKEN` | ingest 调 purge 端点 |
| Secret | 日程管理端三项 | `/admin/schedule` 与 `/api/admin/schedule` 的 Basic 登录与 Cookie 签名；名称见 `.dev.vars.example` |
| Secret | `YT_COOKIES` / `MIHOMO_SUB_URL` | 抓取（GitHub Actions） |
| Var | `PUBLIC_R2_BASE` | 封面 / 表情公开域名，`https://ymmt-s3.chilfish.top`（构建时内联） |
| Var | `SITE_URL` | canonical / sitemap / purge 地址，`https://ymmt.chilfish.top` |

`DATABASE_URL` 不进入客户端 bundle；只从 `astro:env/server` 或服务端读取。

## R2 布局

桶是 `yumemita-data`，对象直接放在桶根，没有公共前缀：

```text
archive/<datasetId>/<videoId>.datapack.json   # 原始 pack，重放 / 恢复用
<datasetId>/thumbs/<videoId>.jpg              # 原图
<datasetId>/thumbs/<videoId>.<width>.webp     # 480 / 960 / 1280
emojis/<datasetId>/<hash>.png
emojis/youtube/<hash>.png
<datasetId>/transcripts/<videoId>.json        # 逐字稿正文
```

- 封面 / 表情走 R2 公开域名 `https://ymmt-s3.chilfish.top`；逐字稿正文通过 Worker binding 读取，不直接暴露。
- 不再写 `index.json` / `manifest.json` / `insights.json` / `group-*.json` / `authors.json`；这些由数据库查询生成。
- `wrangler.jsonc` 的 `r2_buckets` 必须绑定这个桶；Worker 用 `transcripts.r2_key` 直接 `get()`，不要再拼前缀。

### CORS

浏览器会跨域请求表情索引（`fetch`），桶需要允许站点域名。规则用 wrangler 维护：

```bash
bunx wrangler r2 bucket cors set yumemita-data --file scripts/r2-cors.json
bunx wrangler r2 bucket cors list yumemita-data
```

- 允许来源：`https://ymmt.chilfish.top`、`https://*.chilfish.top`、`http://localhost:4321`、`http://127.0.0.1:4321`。
- 允许方法：`GET` / `HEAD`；暴露 `Content-Length` / `Content-Type` / `ETag` / `Cache-Control`；预检缓存 1 小时。
- 封面 `<img>` 本身不需要 CORS；规则主要服务表情索引与后续按需读取。

## 缓存

- 数据页用 `Astro.cache.set({ maxAge, swr, tags })`；endpoint 用 `context.cache.set()`。
- `Cache-Tag`：`group`、`gallery`、`dataset-<id>`、`stream-<videoId>`、`transcripts`、`schedule`、`sitemap`、`llms`。
- 404 与 purge 端点 `no-store`；其余数据页 TTL 60–300 秒，`stale-while-revalidate` 300–600 秒。
- 缓存是 Workers Cache；zone 级 purge 不影响它，只能调 Worker 内部端点。
- 观察 `Cf-Cache-Status` 与 middleware 的 `x-response-time`。
- 部署默认冷缓存；不要开 `cross_version_cache` 直到有版本 tag 策略。

### 内部 purge

```bash
bun run purge:cache --dataset nonoka --video <videoId>
bun scripts/purge-cache.ts --tags group,sitemap,llms
```

```http
POST /api/internal/cache/purge
Authorization: Bearer <PURGE_TOKEN>
Content-Type: application/json

{ "tags": ["stream-W0bKqP-Eyj4", "dataset-nonoka", "group", "sitemap"] }
```

无 token / token 不匹配返回 401；缓存未启用时返回 `{ success: true, invalidated: false }`。

## 每日数据流程

`.github/workflows/data.yml` 只支持手动 `workflow_dispatch`。原来的每日 05:17 UTC（14:17 JST）cron 已于 2026-11-09 取消；需要定时改用外部调度器触发 `workflow_dispatch`。

```text
checkout → Bun / Node / Deno / yt-dlp / PO token / mihomo
  → 校验 DATABASE_URL 与 R2 凭据
  → 读最近一场做 YouTube 探针（来自数据库）
  → daily-update.ts
      频道差集（对比 streams 表）
      → 抓新场次 / 定点重抓
      → backfill-vstats（只补单场页，每成员默认 20 场）
      → publish-transcripts
      → ingest-db（事务 upsert + insights）
      → publish-data --assets-only（封面 / 表情 / archive）
      → purge 缓存 tag
  → 失败开 issue
```

- 安静日：频道无新场次、本地 pack 不比数据库新、VSTATS 也没有补到新场次时，不抓取、不 ingest、不发布。
- `--no-publish` 只写本地，不写库、不上传、不 purge。
- 没有新场次时不会触发前端构建；页面在 ingest + purge 后生效。
- 全量弹幕以后另开任务，不进每日流程。

## Migration

```bash
bun run db:generate     # 生成 SQL
bun run db:migrate      # 应用到 DATABASE_URL
```

- 先加列 / 建表（向后兼容），再部署使用新列的代码；删除列放到下一次。
- 回滚：`wrangler rollback`；数据库用 Neon 分支 / 时间点恢复；R2 从本地 `data/` 重新上传。

## 冒烟

```bash
bun run preview
bun run test:smoke
BASE_URL=https://ymmt.chilfish.top bun run test:smoke   # 线上
```

冒烟覆盖 `/`、`/gallery`、成员 6 个栏目、单场、`.md`、302、404、sitemap、llms、robots。
