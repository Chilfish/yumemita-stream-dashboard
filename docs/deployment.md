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
└─ data/          # index.json + <dataset>/manifest.json + datapack
```

`dist/` 是纯静态文件，不需要 Node 运行时。

## 本地预览

```bash
bun run preview
# 默认 http://localhost:4173
```

## 静态托管

### GitHub Pages

1. 仓库 Settings → Pages → Source 选 GitHub Actions（或用 `gh-pages` 分支）。
2. 如果部署在 `https://<user>.github.io/<repo>/`，在 `vite.config.ts` 设置：

```ts
export default defineConfig({
  base: "/<repo>/",
  // ...
});
```

数据加载使用 `import.meta.env.BASE_URL`，会自动带上子路径，不需要改代码。

3. 构建后把 `dist/` 发布。

### Netlify / Vercel / Cloudflare Pages

| 项 | 值 |
| --- | --- |
| Build command | `bun run build` |
| Output directory | `dist` |
| Install command | `bun install --frozen-lockfile` |
| Node version | 22.22+ |

这些平台通常支持 Bun；如果没有，用 `npm install && npm run build` 也可以（脚本内部调用 `vite`）。

### 单页应用回退

不需要。项目使用 **hash 路由**（`#/:datasetId/...`），所有页面都由 `index.html` 加载，路径不会出现在 HTTP 请求里。

- 不需要配置 `/* -> /index.html` 的 rewrite。
- 子路径部署（`https://user.github.io/repo/`）也直接可用，hash 不参与 base 解析。

## 缓存策略

- `assets/*` 带 content hash，可以长缓存（`Cache-Control: public, max-age=31536000, immutable`）。
- `data/*.json` **不要长缓存**，否则更新数据后用户看到旧值。建议：
  - `Cache-Control: no-cache`（每次 revalidate），或
  - `max-age=300` 之类的短缓存。
- `index.html` 用 `no-cache`。

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

- 当前 30 场数据约 1 MB；构建后 `dist/data/` 同量级。
- JS 主包约 447 KB（gzip ~144 KB），CSS 约 240 KB（gzip ~32 KB）。
- 视图已按路由 `React.lazy()` 拆包，总览/单场/对比/数据表/说明各自是独立 chunk；数据仍按 manifest 懒加载。

## 回滚

静态站点回滚 = 重新部署上一版 `dist/`。数据回滚 = 恢复 `data/` 的上一版提交并重新构建。两者都在 Git 历史里。
