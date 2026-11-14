# 测试

全部测试集中在这里，框架统一为 **Vitest**（配置见 [vitest.config.ts](../vitest.config.ts)）。

```bash
bun run test          # 单次
bun run test:watch    # watch
bunx vitest run tests/lib/format.test.ts   # 单个文件
```

## 目录结构

目录镜像被测源码的位置，便于反查：

```text
tests/
├─ lib/                  ← src/lib/
├─ db/queries/           ← src/db/queries/
├─ components/           ← src/components/
└─ scripts/
   ├─ lib/               ← scripts/lib/（含 cli/）
   └─ commands/          ← scripts/commands/
```

新增测试时按被测文件的相对路径落到对应目录，文件名保持 `<源文件名>.test.ts`。

## 导入约定

测试不在源码旁边，一律用别名而不是相对路径：

| 被测代码 | 写法 |
| --- | --- |
| `src/lib/format.ts` | `import { formatDate } from '@/lib/format'` |
| `scripts/lib/env.ts` | `import { loadEnvFiles } from '@scripts/lib/env.ts'` |

- `@/*` → `src/*`，`@scripts/*` → `scripts/*`，两者在 `vitest.config.ts` 与 `tsconfig.json` 里同步声明。
- 源码内部互相导入仍按源码自己的风格写；只有测试文件用别名。

## 写法

- 结构 Given-When-Then；每条 `it` 至少一条断言。
- 禁止空 `describe`、全 `skip`、`only` 或条件断言冒充通过。
- 临时文件写到 `mkdtempSync(tmpdir())`，用例结束删除，不碰仓库里的 `data/`。
- 需要环境变量时用 `vi.stubEnv`，并在 `afterEach` 调 `vi.unstubAllEnvs()`。

## 不在本目录的验证

路由冒烟、页面性能冒烟这类需要跑起来的检查不是单测，走 CLI：

```bash
bun run ymmt test smoke     # 先起 preview
bun run ymmt test perf --url http://127.0.0.1:8787
```
