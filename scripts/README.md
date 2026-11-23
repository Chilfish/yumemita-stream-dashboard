# scripts

脚本入口与约定见 [docs/engineering/cli.md](../docs/engineering/cli.md)；数据包字段与抓取流程见
[docs/data/datapack.md](../docs/data/datapack.md)。

## 一眼看全

```bash
bun run ymmt --help            # 命令树
bun run ymmt describe --json   # 机器可读的完整命令表
```

| 位置 | 作用 |
| --- | --- |
| `cli.ts` | 唯一入口，只做总装 |
| `commands/<group>/` | 每个文件一个 `CommandSpec`，由同目录 `index.ts` 汇总成分组 |
| `oneoff/` | 一次性补丁（回填、迁移、修复），不进 `package.json` |
| `lib/` | 抓取、发布、存储、环境等共享逻辑；`lib/cli/` 是 runtime |

## 一次性脚本

不注册子命令，直接跑；都支持 `-h`：

```bash
bun scripts/oneoff/apply-collaborations.ts --dry-run
bun scripts/oneoff/backfill-owner-chats.ts --dataset yuno
bun scripts/oneoff/backfill-author-id.ts --root ./temp/youtube-live
bun scripts/oneoff/enrich-chat.ts --root ./temp/youtube-live
bun scripts/oneoff/missing-danmaku.ts --root ./temp/youtube-live
bun scripts/oneoff/suggest-collaborations.ts --json
bun scripts/oneoff/add-datapack.mjs <path>
```

## 运行环境

脚本开工前打印一行目标环境，不用等跑完才知道连的是本机还是线上：

```text
[data.update] 本地模式（LOCAL=1） · 数据库 localhost:5432/ymmt_dev · 对象存储 http://127.0.0.1:9000/yumemita-data
```

目标环境由 `@chilfish/devkit/env` 的 `describeEnvironment()` 统一打印。环境变量按文件分层
（模板 `.dev.vars.example`）：`.dev.vars` 是 base，`LOCAL=1` 时叠加 `.dev.vars.dev`，
`LOCAL=0` 时叠加 `.dev.vars.prod`，后读的覆盖先读的。

## 批处理并发

分批任务统一走 `lib/pool.ts` 的 `runPool(items, concurrency, task, options)`：
有界并发、单项失败只记录、可选重试与超时。约定与现有调用点见
[docs/engineering/concurrency.md](../docs/engineering/concurrency.md)，不要在命令里再手写 worker 循环。
