# 本地数据库（Local PostgreSQL）

> **最后更新**：2026-11-05
> 本地开发不再连 Neon，避免把开发 / 预览 / 爬虫流量算进线上出流量。生产与脚本的凭据仍留在 `.env`。

## 为什么需要代理

`astro dev` 与 `astro preview` 都跑在 workerd 里。workerd 没有 TCP socket，`pg` 无法直连本机 Postgres；页面读路径用的是 `@neondatabase/serverless` 的 HTTP 驱动，它只会说 Neon 的 `/sql` 协议。

因此本地开发分两条路：

| 场景 | 驱动 | 说明 |
| --- | --- | --- |
| workerd（dev / preview） | Neon HTTP 驱动 → `dev:db:proxy` → 本机 Postgres | 代理把 `/sql` 翻译成 `pg` 查询 |
| Bun / Node 脚本（ingest / verify） | `pg` 直连 | `DATABASE_URL` 是本机地址时自动切换 |

代码位置：

- `src/db/connection.ts`：URL 是本机（`localhost` / `127.0.0.1` / `::1`）时，`createDb` / `createWriteDb` 走 `pg`；传入 `NEON_HTTP_ENDPOINT` 时强制走 HTTP 驱动。
- `scripts/dev-db-proxy.ts`：本地 `/sql` 代理，只接受本机数据库地址。
- `scripts/dev-db.ts`：创建数据库、执行迁移、写 `.env.local`。

## 一次性安装（Windows / Scoop）

```powershell
scoop install postgresql
# 数据目录：D:\Scoop\persist\postgresql\data
pg_ctl start -D "$env:PGDATA"
```

Scoop 会把 `bin` 加到用户 PATH，新开的终端才能直接用 `pg_ctl`。当前终端没生效时用完整路径：

```powershell
& "$env:SCOOP\apps\postgresql\current\bin\pg_ctl" start -D "$env:SCOOP\persist\postgresql\data"
```

macOS / Linux 用系统包管理器安装 Postgres 即可，后续命令相同。

## 初始化

```bash
bun run dev:db
```

会做三件事：

1. 若 `.env.local` 不存在，写入本地 `DATABASE_URL`（默认 `postgres://postgres@localhost:5432/ymmt_dev`）；
2. 创建数据库（不存在时）；
3. 应用 `drizzle/` 迁移。

切换端口或库名：`bun run dev:db --url postgres://postgres@localhost:5433/ymmt_dev`。

## 启动开发

workerd 读 `.dev.vars`，不是 `.env.local`。确认这两行（`.dev.vars` 已 gitignore）：

```env
DATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev
NEON_HTTP_ENDPOINT=http://127.0.0.1:4444/sql
```

然后开两个终端：

```bash
# 终端 A
bun run dev:db:proxy

# 终端 B
bun run dev
```

`bun run preview` 同样走 `.dev.vars` 与代理。

验证代理：

```bash
curl http://127.0.0.1:4444/health
# {"ok":true,"database":"ymmt_dev","queries":0}
```

打开页面后 `queries` 会增加，说明查询确实落在本地库。

## 灌入数据

```bash
# 全部成员（首次较慢）
bun run dev:seed

# 只灌一个成员
bun run dev:seed --dataset nonoka
```

脚本读 `.env.local`（优先于 `.env`），所以 `db:ingest` / `db:verify` / `db:query` 都指向本地库。

`db:ingest` 会同时写 `dataset_insights.totals` 与 `public_totals`，页面汇总只读后者。

## 与线上环境的关系

| 文件 | 用途 | 是否提交 |
| --- | --- | --- |
| `.env` | Neon 连接、R2 凭据；发布 / 部署 / CI | 否 |
| `.env.local` | 本地开发覆盖（优先于 `.env`） | 否 |
| `.dev.vars` | workerd（dev / preview）运行时变量 | 否 |

- `loadEnvFiles()` 的优先级：真实进程环境 > `.env.local` > `.dev.vars` > `.env`。
- 发布资产、每日任务、部署必须用 `.env` 里的线上库；执行前确认 `DATABASE_URL` 不是本机地址。
- `.dev.vars` 改成线上库即可让 dev / preview 直接连 Neon；不建议日常这么做。

## 停止

```bash
# 停代理：终端 A 里 Ctrl+C
pg_ctl stop -D "$env:PGDATA"
```

## 排查

| 现象 | 检查 |
| --- | --- |
| 页面 500，日志含「无法直连本地 Postgres」 | `.dev.vars` 缺 `NEON_HTTP_ENDPOINT`，或代理没启动 |
| 页面空白 / 表为空 | 本地库还没灌数据：`bun run dev:seed` |
| `pg_isready` 无响应 | `pg_ctl status -D "$env:PGDATA"`；卡在恢复时看数据目录日志 |
| 代理 400 | 代理会把 Postgres 报错原样返回；先修 SQL 或数据 |
| 端口占用 | `DEV_DB_PROXY_PORT=4445 bun run dev:db:proxy`，同时改 `.dev.vars` 的端点 |
