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
- `scripts/dev.ts`：`bun run dev` 的入口，先准备本地服务，再用 Node 启动 Astro。
- `scripts/lib/dev-services.ts`：启动 / 复用 Postgres 与代理、建库、跑迁移、补齐 `.env.local` / `.dev.vars`。
- `scripts/dev-db-proxy.ts`：本地 `/sql` 代理，只接受本机数据库地址。
- `scripts/dev-db.ts`：只做建库 + 迁移 + 写 `.env.local` 的独立命令。

## 一次性安装（Windows / Scoop）

```powershell
scoop install postgresql
```

脚本会自动定位 `pg_ctl`：优先 `PG_CTL` / `PATH`，其次 `scoop prefix postgresql`、
`%SCOOP%\apps\postgresql\current\bin`，最后 `C:\Program Files\PostgreSQL\*`。
数据目录优先 `PGDATA`，其次 Scoop 的 `persist\postgresql\data`。

macOS / Linux 用系统包管理器安装 Postgres 即可；脚本会从 `PATH`、`pg_config --bindir`、
`/usr/lib/postgresql/*/bin`、Homebrew 的 `opt/postgresql*` 中查找。

## 启动开发：一条命令

```bash
bun run dev
```

它会依次：

1. 按 `.env` → `.dev.vars` → `.env.local`（后者覆盖前者，真实进程环境最高）解析 `DATABASE_URL`；
2. `DATABASE_URL` 是本机地址时，启动 Postgres（已在运行则跳过）、创建 `ymmt_dev`、应用 `drizzle/` 迁移；
3. 缺少 `.env.local` / `.dev.vars` 时补写本地地址与 `NEON_HTTP_ENDPOINT=http://127.0.0.1:4444/sql`；
4. 启动或复用 `dev:db:proxy`；
5. 用 **Node** 启动 Astro（Bun 运行时的 fetch 会让 miniflare 报 `ECONNREFUSED`，不要改回去）。

输出示例：

```text
[dev] Postgres 已在运行（D:\Scoop\apps\postgresql\current\data）
[dev] 代理就绪（pid 925604）：http://127.0.0.1:4444/sql -> localhost:5432/ymmt_dev
 astro  v7.4.5  ready in 9979 ms
```

**Postgres 与代理不由 Astro 托管。** `astro dev` 退出、被 Ctrl+C 或被 `taskkill /T` 杀掉后，
两者继续在后台运行；再次 `bun run dev` 会复用它们，只有健康检查失败时才重启代理。
Postgres 日志在 `temp/postgres.log`，代理日志在 `temp/dev-db-proxy.log`。

验证代理：

```bash
curl http://127.0.0.1:4444/health
# {"ok":true,"pid":925604,"host":"localhost:5432","database":"ymmt_dev","queries":0}
```

打开页面后 `queries` 会增加，说明查询确实落在本地库。

## 单独初始化（可选）

换了库名 / 端口，或不想启动 Astro 时：

```bash
bun run dev:db                                        # 默认 postgres://postgres@localhost:5432/ymmt_dev
bun run dev:db --url postgres://postgres@localhost:5433/ymmt_dev
bun run dev:db:proxy                                  # 只起代理（前台）
```

`dev:db` 会拉起 Postgres（未运行时）、写 `.env.local`、建库并应用迁移，但不起代理；`dev:db:proxy` 需要自己另开终端，`bun run dev` 一般不需要它。

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
- `.dev.vars` 改成线上库即可让 dev / preview 直接连 Neon；脚本会提示，但不建议日常这么做。

## 停止

Postgres 与代理不会随 Astro 退出；需要时手动停：

```bash
# 代理：先看 pid
curl http://127.0.0.1:4444/health
# Windows
Stop-Process -Id <pid>
# macOS / Linux
kill <pid>

# Postgres
pg_ctl stop -D "$PGDATA"
```

## 排查

| 现象 | 检查 |
| --- | --- |
| 启动时提示「未找到 pg_ctl」 | 设置 `PG_CTL` 指向可执行文件、`PGDATA` 指向数据目录，或按上面的顺序安装 PostgreSQL |
| 启动时提示「数据目录不可用」 | 数据目录没初始化：`initdb -D <PGDATA>`；或 `PGDATA` 指错了 |
| 页面 500，日志含「无法直连本地 Postgres」 | `.dev.vars` 缺 `NEON_HTTP_ENDPOINT`，或代理没启动；删掉该行后重跑 `bun run dev` 会自动补 |
| 提示「端口已被另一个开发代理占用」 | 上一个代理连着别的库：按提示的 pid 停掉，或改 `DEV_DB_PROXY_PORT` 并同步 `.dev.vars` |
| 页面空白 / 表为空 | 本地库还没灌数据：`bun run dev:seed` |
| `pg_isready` 无响应 | `pg_ctl status -D "$PGDATA"`；卡在恢复时看 `temp/postgres.log` |
| 代理 400 | 代理会把 Postgres 报错原样返回；先修 SQL 或数据 |
| Astro 报 `ECONNREFUSED`（miniflare） | Astro 被 Bun 执行了；`bun run dev` 已固定用 Node，不要改动 `scripts/dev.ts` 的启动方式 |
| 端口占用 | `DEV_DB_PROXY_PORT=4445 bun run dev:db:proxy`，同时改 `.dev.vars` 的端点 |
