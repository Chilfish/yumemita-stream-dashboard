# 脚本 CLI

数据流水线的所有脚本收敛成一个入口：`bun scripts/cli.ts <group> <command> [选项]`，
别名 `bun run ymmt <group> <command>`。

- 参数解析、`--help`、日志、退出码、JSON 信封由 `@chilfish/devkit/cli` 统一提供。
- 命令实现在 `scripts/commands/<group>/<command>.ts`，每个文件导出一个 `CommandSpec`。
- 一次性补丁脚本在 `scripts/oneoff/`，不注册子命令、不进 `package.json`。
- 补数据 / 同步线上该走哪条命令，见 [data-maintenance skill](../../.agents/skills/data-maintenance/SKILL.md)。

## 常用

```bash
bun run ymmt --help                        # 所有分组
bun run ymmt db --help                     # 分组下的命令
bun run ymmt data update --help            # 单条命令的完整选项
bun run ymmt describe --json               # 完整命令树，供 agent 自举
```

## 重抓单场

```bash
bun run ymmt data refetch "https://www.youtube.com/watch?v=1dGnP_rXgW0"
bun run ymmt data refetch 1dGnP_rXgW0 --no-online      # 只改本地 pack / 本地库
bun run ymmt data refetch <链接> --dataset nonoka --dry-run
```

- 链接解析支持 `watch?v=`、`youtu.be`、`/live/`、`/shorts/`，也接受裸 11 位 ID。
- dataset 先按 `data/<id>/<videoId>.datapack.json` 推断；本地没有 pack 时用 yt-dlp 元信息的频道 ID 匹配 `data-sources.json`。
- 顺序固定：重抓素材 → 重建 datapack → 本地 ingest → 线上 ingest → 定向 verify → publish data → purge。
- 默认写线上（`.dev.vars.prod` 的 `DATABASE_URL` 与 `R2_*`）；`--no-online` 只写本地并重算本地 manifest / insights。
- 定向 verify 有差异时继续发布，命令以退出码 1 结束。

## 把本地已有场次推到线上

pack 已经在 `data/<dataset>/`、本地库也能正常看，只想让线上也有这一场：

```bash
bun run ymmt publish push Jih2ArVViRo                  # 按 pack 所在目录自动归属
bun run ymmt publish push "https://www.youtube.com/watch?v=Jih2ArVViRo" --dry-run
bun run ymmt publish push Jih2ArVViRo --dataset other  # 跳过推断
```

- 只处理指定的一场，不重抓素材；顺序：线上 ingest → 刷新公开汇总 → 定向 verify → publish data → purge。
- 归属按 `data/<dataset>/<videoId>.datapack.json` 反查，多个 dataset 都有同名 pack 时取 `data-sources.json` 里的第一个；本地没有 pack 直接报错并提示先抓取。
- 线上目标只认 `.dev.vars.prod`，执行期间强制 `LOCAL=0`；`--dry-run` 会先查线上是否已有这一场，说明是新增还是覆盖。
- 需要重新抓素材（弹幕 / 评论 / VSTATS 更新）用 `data refetch`，不要用本命令。

批量补推（例如一次放了多场）走 `publish sync`。默认只看最近 7 天开播的 pack，老场次补推要显式放开窗口：

```bash
bun run ymmt publish sync --dataset other --recent-days 0 --dry-run
bun run ymmt publish sync --dataset other --recent-days 0
```

## 手动添加官方账号的场次

`bangdream` 母频道与第三方官方账号的场次都走这条命令：母频道的出演信息只在简介，第三方账号偶尔才办本团出演的直播（商店直播、企划方节目、签名会）。参与者无法从标题可靠推断，必须显式指定：

```bash
bun run ymmt data official "https://www.youtube.com/watch?v=Jih2ArVViRo" --participants all
bun run ymmt data official "https://www.youtube.com/watch?v=4l7mcDP7-ZY" --participants yuno
bun run ymmt data official "https://www.youtube.com/live/V2AJBNJGR8E" --participants all --dry-run
```

- `--participants` 必填：`all` 展开为全部成员，或用逗号分隔的成员 id（可重复传入）。未知 id 直接报错。
- 默认落到聚合账号 `other`；`--dataset` 可指向任意官方账号（例如 `bangdream`），指向成员频道会被拒绝。`bangdream` 与 `other` 都是 `sync=manual`。
- 参与者写进 `content/collaborations.json`，由 ingest 落到 `streams.participants`。
- 顺序：元信息 → 登记 → `data fetch --ids` → 本地 ingest → 线上 ingest → verify → publish → purge。`--no-online` 只改本地，之后再补推单场用 [`publish push`](#把本地已有场次推到线上)。
- 场次还没结束（`is_upcoming` / `is_live`）会直接拒绝；未来场走 `/admin/schedule`。

`data update` 不会碰 `sync=manual` 的账号（`bangdream`、`other`）。详见 [official-channels.md](../planning/official-channels.md)。

## 命令树

| 命令 | 作用 |
| --- | --- |
| `data update` | 每日增量：频道差集 → 定点抓取 → 补 VSTATS / 封面 → ingest → 联动参与者对账 → 发布 → purge；成员之间并发（`--dataset-concurrency`），写库与发布串行 |
| `data fetch` | 按频道补齐历史场次，每 N 场生成 datapack |
| `data refetch` | 单场重抓并覆盖：给链接或 ID，重抓素材并同步本地库、线上库与索引 |
| `data official` | 手动添加第三方官方账号里的本团联动场次（参与者必填） |
| `data vstats` | 只补 VSTATS 单场页数据 |
| `data thumbnails` | 镜像封面并生成 480 / 960 / 1280w WebP |
| `data emoji` | 镜像频道与 YouTube 全局表情 |
| `data danmaku` | 只抓弹幕回放，补齐缺失 jsonl |
| `data live-chat` | InnerTube 实时聊天采集 |
| `data datapack` | 把一场素材合并成 datapack |
| `db ingest` | 本地 pack 写入 PostgreSQL（增量、一场一事务） |
| `db pull` | 线上库增量同步到本机库（按 `content_hash`，日程表整体覆盖） |
| `db verify` | 数据库与本地 pack 字段级对账 |
| `db migrate` | 应用 drizzle 迁移 |
| `db query` | 查询层冒烟 + 本地延迟 |
| `db bench` | 读路径压测（p50 / p95） |
| `db latest` | 输出最新一场 videoId（CI 探针） |
| `db totals` | 只重算 `dataset_insights.public_totals` |
| `db schedules` | 清理已入库日程、归一自然键（默认 dry-run） |
| `publish data` | 生成索引 / insights 并上传资产 |
| `publish transcripts` | 校验并增量上传逐字稿 |
| `publish sync` | 本地 → 线上库与对象存储同步 |
| `publish push` | 把本地已有的一场推到线上（不重抓素材） |
| `publish purge` | 按 cache tag 失效 Workers Cache |
| `transcript new` | 按模板新建逐字稿 |
| `transcript import` | 导入写好的 Markdown |
| `validate data` | 校验本地 datapack schema |
| `validate content` | 校验 v2 数据自洽与远端对象 |
| `test smoke` | 路由冒烟（需先起 dev / preview） |
| `test perf` | 页面级性能冒烟 |
| `dev` | 拉起本地 Postgres / 代理并启动 Astro |
| `dev db` | 只做本地库初始化 |
| `dev proxy` | 前台启动 Neon HTTP 兼容代理 |
| `dev storage` | 启动本地 SILO 对象存储 |
| `dev status` | 只读检查本地服务状态（Postgres / 代理 / SILO） |
| `tool cookies` | 导出 YouTube 登录态 cookie |
| `tool mihomo` | 生成 CI 用的 mihomo 配置 |
| `deploy` | 构建并部署到 Cloudflare Workers |

## 全局选项

每条命令都支持：

| 选项 | 说明 |
| --- | --- |
| `--json` | stdout 只输出一行 JSON 信封，日志改走 stderr |
| `--quiet` | 只保留警告与错误 |
| `--dry-run` | 只读：不写库、不写对象存储、不改本地文件 |
| `--log-level <level>` | `debug` / `info` / `warn` / `error`，默认 `info` |
| `--log-file <path>` | 把日志以 NDJSON 追加写入文件 |
| `-h, --help` | 显示帮助 |

`--json` 模式下的 stdout 只有信封，方便 `| jq`：

```json
{ "ok": true, "command": "db.ingest",
  "data": { "processed": 12, "skipped": 3, "failed": 0 },
  "error": null,
  "meta": { "mode": "local", "durationMs": 1234, "dryRun": false, "version": "0.1.0" } }
```

失败同样是信封，`error` 带稳定 `code`、说明与可直接照抄的 `hint`：

```json
{ "ok": false, "command": "db.latest", "data": null,
  "error": { "code": "MISSING_ENV", "message": "缺少环境变量 DATABASE_URL",
             "hint": "在 .dev.vars 里配置 DATABASE_URL", "context": { "name": "DATABASE_URL" } },
  "meta": { "mode": "local", "durationMs": 12, "dryRun": false, "version": "0.1.0" } }
```

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功 / 已收敛 |
| 1 | 运行期失败（批量任务里部分项失败也算） |
| 2 | 用法错误：未知参数、缺必填、非法取值 |
| 3 | 配置缺失：`DATABASE_URL` / `R2_*` / `SITE_URL` 未配置 |

## 日志与环境

- 每条命令开工前打印一行目标环境（`本地模式（LOCAL=1） · 数据库 … · 对象存储 …`），
  不必等跑完才知道连的是本机还是线上。
- 人读日志一律写 stderr；stdout 只留给命令的数据输出，所以
  `probe=$(bun run ymmt db latest 2>/dev/null)` 不会被日志污染。
- 不做「非 TTY 自动 JSON」：CI 日志也需要可读，机器契约只在显式 `--json` 时生效。

## 一次性脚本（`scripts/oneoff/`）

数据修复、回填、迁移补丁不注册子命令，也不进 `package.json`：

```bash
bun scripts/oneoff/apply-collaborations.ts --dry-run
bun scripts/oneoff/backfill-owner-chats.ts --dataset yuno
bun scripts/oneoff/enrich-chat.ts --root ./temp/youtube-live
bun scripts/oneoff/missing-danmaku.ts
bun scripts/oneoff/suggest-collaborations.ts --json
bun scripts/oneoff/add-datapack.mjs <path>
```

每个都支持 `-h` 看用法。它们同样用统一 runtime，所以 `--json`、退出码约定与主命令一致。

## 新增一条命令

1. 在 `scripts/commands/<group>/` 新建 `<command>.ts`，导出 `CommandSpec`（`id`、`description`、`options`、`run`）。
2. 在 `scripts/commands/<group>/index.ts` 的 `commands` 数组里登记。
3. `bun run ymmt <group> <command> --help` 能查到，`describe --json` 里能看到。
4. 更新本页命令表。

## 迁移对照（旧 → 新）

| 旧 | 新 |
| --- | --- |
| `bun scripts/daily-update.ts` | `bun run ymmt data update` |
| `bun scripts/fetch-streams.ts` | `bun run ymmt data fetch` |
| `bun scripts/backfill-vstats.ts` | `bun run ymmt data vstats` |
| `bun scripts/fetch-thumbnails.ts` | `bun run ymmt data thumbnails` |
| `bun scripts/fetch-emoji.ts` | `bun run ymmt data emoji` |
| `bun scripts/fetch-danmaku.ts` | `bun run ymmt data danmaku` |
| `bun scripts/fetch-live-chat.ts` | `bun run ymmt data live-chat` |
| `bun scripts/stream-datapack.ts` | `bun run ymmt data datapack` |
| `bun run ymmt db ingest` | `bun run ymmt db ingest` |
| `bun run ymmt db verify` | `bun run ymmt db verify` |
| `bun run ymmt db migrate` | `bun run ymmt db migrate` |
| `bun run ymmt db query` | `bun run ymmt db query` |
| `bun run ymmt db bench` | `bun run ymmt db bench` |
| `bun run ymmt db latest` | `bun run ymmt db latest` |
| `bun scripts/refresh-public-totals.ts` | `bun run ymmt db totals` |
| `bun run ymmt db schedules` | `bun run ymmt db schedules` |
| `bun run ymmt publish data` | `bun run ymmt publish data` |
| `bun run ymmt publish data --assets-only` | `bun run ymmt publish data --assets-only` |
| `bun run ymmt publish transcripts` | `bun run ymmt publish transcripts` |
| `bun run ymmt publish sync` | `bun run ymmt publish sync` |
| `bun run ymmt publish purge` | `bun run ymmt publish purge` |
| `bun run ymmt transcript new` | `bun run ymmt transcript new` |
| `bun run ymmt transcript import` | `bun run ymmt transcript import` |
| `bun run ymmt validate data` | `bun run ymmt validate data` |
| `bun run ymmt validate content` | `bun run ymmt validate content` |
| `bun run ymmt test smoke` | `bun run ymmt test smoke` |
| `bun run ymmt test perf` | `bun run ymmt test perf` |
| `bun run dev` | `bun run ymmt dev`（别名保留 `bun run dev`） |
| `bun run dev:db` | `bun run ymmt dev db`（别名保留 `bun run dev:db`） |
| `bun run ymmt dev proxy` | `bun run ymmt dev proxy` |
| `bun run ymmt dev storage` | `bun run ymmt dev storage` |
| `bun run cf:deploy` | `bun run ymmt deploy`（别名保留 `bun run cf:deploy`） |
| `bun scripts/export-yt-cookies.ts` | `bun run ymmt tool cookies` |
| `bun scripts/mihomo-config.ts` | `bun run ymmt tool mihomo` |

## 代码位置

```text
scripts/
├─ cli.ts                    # 唯一入口：buildCli({ config, version, groups, rootCommands, labels })
├─ dev.config.ts             # devkit 配置：数据库 / 代理 / 桶 / 迁移 / 日志 / dev server
├─ commands/
│  ├─ index.ts               # 汇总所有 CommandGroup（data / db / publish / … / dev / tool）
│  ├─ dev-group.ts           # createDevCommands(devkit) + 中文帮助文案
│  ├─ data/  db/  publish/  transcript/  validate/  test/  tool/
│  │  ├─ <command>.ts        # 一个文件一个 CommandSpec
│  │  └─ index.ts            # 该分组导出 CommandGroup
│  └─ deploy.ts              # 顶层命令
├─ oneoff/                   # 一次性补丁，不经 cli.ts
└─ lib/                      # 抓取、发布、存储等共享逻辑
```
