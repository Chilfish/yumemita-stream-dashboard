# 本地开发环境（PostgreSQL + SILO）

> **最后更新**：2026-11-07
> 本地开发默认连本机 Postgres + SILO，避免把开发 / 预览 / 爬虫流量算进线上出流量。
> 环境变量只有一个文件：`.dev.vars`。本地值写普通键，线上目标写 `*_ONLINE`。
> `LOCAL=1` 同时切换数据库、对象存储与媒体地址；见下方「本地对象存储」。

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
- `scripts/lib/dev-services.ts`：启动 / 复用 Postgres 与代理、建库、跑迁移、补齐 `.dev.vars`。
- `scripts/dev-db-proxy.ts`：本地 `/sql` 代理，只接受本机数据库地址。
- `scripts/dev-db.ts`：只做建库 + 迁移 + 补 `.dev.vars` 的独立命令。
- `scripts/lib/local-config.ts`：`LOCAL=1` 的总开关与默认端点 / 凭据。
- `scripts/lib/dev-silo.ts`：本地 SILO 的启动、建桶与匿名读策略。
- `scripts/dev-storage.ts`：只准备本地对象存储（`bun run dev:storage`）。

## 一次性安装（Windows / Scoop）

```powershell
scoop install postgresql
```

脚本会自动定位 `pg_ctl`：优先 `PG_CTL` / `PATH`，其次 `scoop prefix postgresql`、
`%SCOOP%\apps\postgresql\current\bin`，最后 `C:\Program Files\PostgreSQL\*`。
数据目录优先 `PGDATA`，其次 Scoop 的 `persist\postgresql\data`。

macOS / Linux 用系统包管理器安装 Postgres 即可；脚本会从 `PATH`、`pg_config --bindir`、
`/usr/lib/postgresql/*/bin`、Homebrew 的 `opt/postgresql*` 中查找。

## 本地对象存储（SILO）

`LOCAL=1` 会用本机 [SILO](https://silo.pgsty.com/zh/download/#server-windows) 代替 Cloudflare R2。
SILO 是 MinIO 的维护分支，保持 S3 API、`silo server` 命令与 `MINIO_*` 变量契约，健康检查仍是 `/minio/health/live`。

### 安装

- **Windows**：下载 ZIP 解压，把 `silo.exe` 放进 `PATH`，或用 `SILO_BIN` 指定路径。
- **macOS**：`brew tap pgsty/infra && brew install pgsty/infra/silo`。
- **Linux**：下载对应 tar.gz，`sudo install -m 0755 silo /usr/local/bin/silo`。

`bun run dev` / `bun run dev:storage` 会依次查找 `SILO_BIN` → `PATH` 的 `silo` →
Scoop 的 `apps/silo/current/silo.exe`，再回退到已安装的 `minio`（CLI 相同）。
都找不到时只警告，不阻塞页面读库。

### 端点与桶

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LOCAL` | 未设置 | `1` / `true` / `yes` 开启本地总开关 |
| `S3_ENDPOINT` | `http://127.0.0.1:9000` | SILO 的 S3 地址；必须本机 |
| `S3_ACCESS_KEY_ID` | `silo-admin` | 优先于 `MINIO_ROOT_USER` |
| `S3_SECRET_ACCESS_KEY` | `silo-admin` | 优先于 `MINIO_ROOT_PASSWORD` |
| `R2_BUCKET` | `yumemita-data` | 本地桶名；与线上同名但互不影响 |
| `SILO_DATA` | `temp/silo-data` | 数据目录 |
| `SILO_BIN` | 自动查找 | 可执行文件路径 |

启动时自动建桶并设置匿名只读（浏览器要直接取封面 / 表情），CORS 默认放开。
日志在 `temp/silo.log`。SILO 与 Postgres / 代理一样是独立后台进程，Astro 退出后继续运行。

### `LOCAL=1` 做了什么

- `DATABASE_URL` / `NEON_HTTP_ENDPOINT` 不是本机地址时，强制切到本地默认值。
- 对象存储改为指向 SILO；发布进度的 `target` 带 `local/` 前缀，与线上 R2 的记录分开，
  不会互相误判「已上传」而跳过。
- `astro.config.mjs` 在 `LOCAL=1` 时把 `import.meta.env.PUBLIC_R2_BASE` 定义为本地桶地址，
  不把派生的媒体地址落进文件，关掉开关就自动回到线上值。
- 浏览器封面 / 表情、逐字稿 API 的 DEV 回退都改读 SILO；生产仍走 R2 binding。
- `purge:cache` 直接跳过，不会去动线上 Workers Cache。
- `DATAPACK_BASE` 未设置时，`remoteBase()` 返回本地桶地址，`fetch-streams` 的远端恢复也读 SILO。
- 脚本开始做事前先打印目标环境（`[env]` / `[ingest]` / `[publish-data]` 等），
  一行列出模式、数据库与存储桶；`describeEnvironment()` 是唯一实现，本地模式下显示实际会用的本机库和 SILO 地址。

## 启动开发：一条命令

```bash
bun run dev            # 按 .dev.vars：Postgres + 代理 +（LOCAL=1 时）SILO
bun run dev --local    # 强制 LOCAL=1，并把开关写回 .dev.vars
```

`.dev.vars` 里的 `LOCAL=1` 决定普通脚本（`db:ingest` / `publish:*` / `fetch:*`）走本地还是线上；
命令行设的 `LOCAL` 优先于文件。要切到线上，把 `LOCAL` 改成 `0` 或直接 `LOCAL=0 bun run …`。

开发服务器与开关无关：`bun run dev` 始终准备并连本机库，`LOCAL` 只决定对象存储、
媒体地址是否也切到本机。所以 `.dev.vars` 里留本地 `DATABASE_URL` 不会让脚本误连本机库。

它会依次：

1. 读 `.dev.vars` 的 `DATABASE_URL`（`LOCAL=1` 时强制本机地址）；开发服务器无条件用本机库，
   普通脚本按 `LOCAL` 取普通键或 `DATABASE_URL_ONLINE`，见下方「与线上环境的关系」；
2. `DATABASE_URL` 是本机地址时，启动 Postgres（已在运行则跳过）、创建 `ymmt_dev`、应用 `drizzle/` 迁移；
3. 缺少 `.dev.vars` 时按模板补写；`LOCAL=1` 时把本地地址与
   `NEON_HTTP_ENDPOINT=http://127.0.0.1:4444/sql` 覆盖回文件（`*_ONLINE` 的线上目标保持不动）；
4. 启动或复用 `dev:db:proxy`；
5. `LOCAL=1` 时启动或复用 SILO，建桶并设置匿名读；
6. 用 **Node** 启动 Astro（Bun 运行时的 fetch 会让 miniflare 报 `ECONNREFUSED`，不要改回去）。

输出示例：

```text
[env] 本地模式（LOCAL=1） · 数据库 localhost:5432/ymmt_dev · 对象存储 http://127.0.0.1:9000/yumemita-data
[dev] Postgres 已在运行（D:\Scoop\apps\postgresql\current\data）
[dev] 代理就绪（pid 925604）：http://127.0.0.1:4444/sql -> localhost:5432/ymmt_dev
[dev] SILO 就绪：http://127.0.0.1:9000（数据 I:\dev\yumemita-stream-dashboard\temp\silo-data）
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
LOCAL=1 bun run dev:storage                           # 只准备 SILO 与本地桶
```

`dev:db` 会拉起 Postgres（未运行时）、补齐 `.dev.vars`、建库并应用迁移，但不起代理；`dev:db:proxy` 需要自己另开终端，`bun run dev` 一般不需要它。只跑 `publish:*` / `fetch:*` 时，先用 `dev:storage` 确认 SILO 就绪。

## 灌入数据

```bash
# 全部成员（首次较慢）
bun run dev:seed

# 只灌一个成员
bun run dev:seed --dataset nonoka
```

灌数据写哪张库由 `LOCAL` 决定：`LOCAL=1` 时 `db:ingest` / `db:verify` / `db:query` 指向本地库，
`LOCAL=0` 时用 `DATABASE_URL_ONLINE` 的 Neon。执行前看脚本首行的目标环境就能确认。

`db:ingest` 会同时写 `dataset_insights.totals` 与 `public_totals`，页面汇总只读后者。

## 环境文件：只有 `.dev.vars`

| 文件 | 用途 | 是否提交 |
| --- | --- | --- |
| `.dev.vars` | 唯一的本地环境文件：本地值 + `*_ONLINE` 线上目标 | 否 |
| `.dev.vars.example` | 模板，列出所有键与说明 | 是 |

- wrangler / astro dev 原生读 `.dev.vars`；脚本、`astro.config.mjs`、`drizzle.config.ts`
  统一走 `loadEnvFiles()`（`scripts/lib/env.ts`），不再有 `.env` / `.env.local`。
- 普通键是本地值；`DATABASE_URL_ONLINE` 这类 `*_ONLINE` 是线上目标。
  `LOCAL=1` 用普通键（并忽略 `*_ONLINE`），`LOCAL=0` 用 `*_ONLINE` 覆盖同名键。
- `LOCAL` 本身以运行环境为准：`LOCAL=0 bun run …` / `bun run dev --local` 都压过文件。
- 文件只补运行环境里没有的键，所以 `DATABASE_URL=… bun run db:verify` 这种显式覆盖照样生效。
- 线上模式但 `DATABASE_URL` 仍指向本机时，加载器会清掉它并提示——正是为了拦住
  「对象传到 R2、元数据写进本地库」这种混合状态。
- 开发服务器（`bun run dev`）不走上面的判定：它始终准备本机 Postgres / 代理。
- `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` 只在 `LOCAL=1` 时生效；线上仍用 `R2_*`。
- `LOCAL=1` 打开后，`DATABASE_URL` / `NEON_HTTP_ENDPOINT` / `PUBLIC_R2_BASE` 会在加载后强制切到本机。
- 发布资产、每日任务、部署前看脚本首行的目标环境，确认是 Neon 而不是 `localhost`。
- CI 不用文件：GitHub Actions 直接把变量注入进程环境，`loadEnvFiles()` 发现没有 `.dev.vars` 就跳过。

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

# SILO：默认监听 9000（S3）与 9001（Console）
# Windows
Get-NetTCPConnection -LocalPort 9000 | Select-Object -ExpandProperty OwningProcess | Stop-Process
# macOS / Linux
kill $(lsof -ti :9000)
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
| `LOCAL=1` 但提示「未找到 silo」 | 安装 SILO 并加入 `PATH`，或设 `SILO_BIN`；页面读库仍可用，上传会失败 |
| 封面 / 表情 404、逐字稿 503 | 先 `LOCAL=1 bun run dev:storage`；确认 `LOCAL=1` 对 dev 进程可见，媒体地址由 `astro.config.mjs` 注入为 `http://127.0.0.1:9000/yumemita-data`，且桶已设为匿名读 |
| 上传报 403 / SignatureDoesNotMatch | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` 与 SILO 启动时的 `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` 不一致；默认都是 `silo-admin` |
| 本地发布仍显示「跳过未变化」但桶是空的 | 本地进度在 `data/.publish-state.local.json`，`target` 应带 `local/`；确认 `LOCAL=1` 对当前进程可见，且没有被线上 `.publish-state.json` 干扰 |
| SILO 启动失败 | 看 `temp/silo.log`；端口冲突时改 `S3_ENDPOINT` 与 `SILO_CONSOLE_PORT` |
| 线上模式却提示「DATABASE_URL 指向本机」 | `.dev.vars` 只有本地 `DATABASE_URL`、没写 `DATABASE_URL_ONLINE`；补上线上地址，或确认这次本来就要跑本地（`LOCAL=1`） |
| 改了 `.env` 却不生效 | 已经没有 `.env` 了：变量只有 `.dev.vars` 一个来源，`*_ONLINE` 是线上目标 |
| 想临时只改一次数据库 | 直接传进程环境：`DATABASE_URL=… LOCAL=0 bun run db:verify` |
