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

`describeEnvironment()`（`lib/local-config.ts`）是唯一实现。环境变量只有一个文件 `.dev.vars`
（模板 `.dev.vars.example`）：普通键是本地值，`*_ONLINE` 是线上目标，`LOCAL=1` 用普通键，
`LOCAL=0` 用 `*_ONLINE` 覆盖。
