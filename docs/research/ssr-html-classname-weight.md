# SSR 输出里的类名体积（2026-11-15）

> 起因：SSR 页面的 HTML 里 `class="..."` 看着占了很大篇幅，想知道业内有没有常用解法。
> 本文用线上 4 个代表性页面实测，回答三件事：类名到底占多少、压缩后还剩多少成本、业内怎么做、在本仓库值不值得做。
> 可执行项已登记 [backlog.md](../planning/backlog.md) 的 B49。

## 一、结论

| 问题 | 答案 |
| --- | --- |
| 类名占未压缩 HTML 多少 | 4.3%–29.1%（页面越接近纯列表越高） |
| 类名占 brotli 后载荷多少 | 边际成本 2.9%–17.0% |
| 类名在样式表里的成本 | 282 KB 里 105 KB（37%）是选择器文本；重命名可省 40% 的 brotli 体积 |
| 想把 HTML 压下来，先动哪里 | `<astro-island props>`，不是类名 |

四条判断：

1. **类名在 raw HTML 里确实显眼，但压缩后是零头。** 类名高度重复（`/` 有 4,767 个 token 但只有 453 个唯一值），brotli 已经把重复吃掉了。把全部 `class` 属性删掉，`/` 只省 17%，`/arale/transcripts` 只省 4.5%。
2. **类名的真实成本在 CSS，不在 HTML。** 同一个 utility 在 HTML 里出现 N 次、在 CSS 里只出现 1 次；CSS 的选择器文本几乎不可压缩，而 HTML 的类名重复可压缩。所以「重命名类名」这个方案的收益主要来自样式表：实测省 12.1 KB brotli（40.3%）。
3. **HTML 的大头是 `astro-island` 的 props。** `/arale/transcripts` 的 1.19 MB 里 1.04 MB（92.5%）是 `props` 属性；去掉它 brotli 从 78.0 KB 掉到 11.9 KB。这解释了为什么「压缩类名」和「压缩 props」不是一个量级的方案。
4. **raw 体积的下一顺位是「同一条长 cva 字符串按行重复」。** `/arale/streams` 只有 134 种不同的 `class` 值，却写了 446 KB：一条 352 字符的表格单元格类名重复了 400 次。这是组件抽象问题，不是类名长度问题。

## 二、怎么测的

数据来源是线上 `https://ymmt.chilfish.top` 的未压缩响应（`Accept-Encoding: identity`），压缩比在本机用 `node:zlib` 重算，统一口径 `brotli quality 11`。

```powershell
$tmp = "$env:TEMP\ymmt-scale"
# 4 个代表页：首页 / 单场页 / 逐字稿页 / 场次列表
curl.exe -s -H "Accept-Encoding: identity" -o "$tmp/root.html" https://ymmt.chilfish.top/
curl.exe -s -H "Accept-Encoding: identity" -o "$tmp/p0.html" https://ymmt.chilfish.top/arale/stream/xBZHYX6-bFw
curl.exe -s -H "Accept-Encoding: identity" -o "$tmp/p1.html" https://ymmt.chilfish.top/arale/transcripts
curl.exe -s -H "Accept-Encoding: identity" -o "$tmp/p2.html" https://ymmt.chilfish.top/arale/streams
curl.exe -s -o "$tmp/app.css" https://ymmt.chilfish.top/_astro/Layout.B-lxya0_.css
```

三个变换各测一遍原始 / gzip / brotli 11：

- **剥离**：删掉所有 ` class="..."`，衡量类名的边际成本。
- **重命名**：把每个唯一 token 换成 6 字符稳定哈希（`c00000`），同步替换 HTML 与 CSS，模拟 minwind 那类构建期重命名。
- **剥 props**：删掉 `<astro-island>` 的 `props` 属性，作为对照。

脚本见附录。重命名是**上界估算**：真实工具还要保留 `hover:` / `data-[...]` / `group-*` 这些前缀结构，收益只会更低，不会更高。

## 三、实测

### 3.1 四个页面

| 页面 | raw | gzip | brotli 11 | class 属性字节 | 占 raw |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 309,877 | 35,987 | 24,331 | 81,887 | 28.4% |
| `/arale/stream/xBZHYX6-bFw` | 423,914 | 74,362 | 55,984 | 53,700 | 14.9% |
| `/arale/transcripts` | 1,194,165 | 120,717 | 78,080 | 49,045 | 4.3% |
| `/arale/streams` | 1,728,085 | 140,490 | 84,130 | 480,191 | 29.1% |

[seo-audit-2026-11-15.md](./seo-audit-2026-11-15.md) 第七节记的「未压缩体积都在 1–2 MB」是同一种现象；这里补上的是**构成**：`/streams` 里 29% 是类名，`/transcripts` 里只有 4%。

### 3.2 类名的边际成本

删掉全部 `class` 属性后的 brotli：

| 页面 | brotli | 删类名后 | 省 |
| --- | ---: | ---: | ---: |
| `/` | 24,331 | 20,185 | **17.0%** |
| `/arale/stream/xBZHYX6-bFw` | 55,984 | 52,533 | 6.2% |
| `/arale/transcripts` | 78,080 | 74,542 | 4.5% |
| `/arale/streams` | 84,130 | 78,201 | 7.0% |

注意 `17.0%` 是上界：真把类名删干净页面就没样式了。可以作为「类名在压缩载荷里的最大成本」来看。

页面越靠「列表 + 表格」，类名占比越高；越靠「props 里塞数据」，类名占比越低。

### 3.3 样式表：这里才是类名的钱

`Layout.B-lxya0_.css`：282,372 B raw / 39,322 B gzip / 29,987 B brotli 11。

| 项 | 值 |
| --- | ---: |
| 类名选择器片段 | 2,249 处 / 2,007 个唯一 |
| 选择器文本字节 | 105,116（占 raw 37.2%） |
| 平均每个选择器 | 46.7 字符 |
| 重命名后 raw | 197,497（-30.1%） |
| 重命名后 brotli | 17,890（**-40.3%，省 12,097 B**） |

同样一份 `flex items-center gap-2` 的语义，在 HTML 里出现 N 次可压缩，在 CSS 里只出现 1 次且 **不可压缩**。所以「类名变短」的收益，HTML 侧个位数百分比，CSS 侧四成。

顺带排除了两个常被怀疑的对象：`@property` 96 块共 6,635 B（bro 仅 503 B），`--tw-*` 变量 1,648 处 96 种，都不是可优化的量级。

### 3.4 重复的长串

`/arale/streams` 共 3,708 个 `class` 属性、446,819 B，但只有 **134 种**不同取值：

| 次数 | 长度 | 合计 | 开头 |
| ---: | ---: | ---: | --- |
| 400 | 352 | 140,800 B | `whitespace-nowrap bg-clip-padding p-2.5 in-data-[slot=table-footer]:py…` |
| 100 | 454 | 45,400 B | `relative not-in-data-[variant=card]:hover:bg-[color-mix(in_srgb,var(…` |
| 100 | 380 | 38,000 B | `whitespace-nowrap bg-clip-padding p-2.5 in-data-[slot=table-footer]:py…` |
| 364 | 40 | 14,560 B | `font-medium text-foreground tabular-nums` |

这些串在 brotli 下几乎免费（所以 `/streams` 的 brotli 只省 7%），但它们是 **raw 体积**和 Googlebot 2 MB 门限的直接原因。把 `td` 的类名收成一个 `.table-cell` 语义类，raw 能省 130 KB，brotli 大概只省一两 KB。

### 3.5 对照：props

| 页面 | props 字节 | 占 raw | 剥 props 后 brotli | 省 |
| --- | ---: | ---: | ---: | ---: |
| `/` | 99,878 | 34.7% | 15,903 | **34.6%** |
| `/arale/transcripts` | 1,049,729 | 92.5% | 11,920 | **84.7%** |
| `/arale/streams` | 1,042,186 | 63.3% | 21,145 | **74.9%** |

props 里是 UUID、标题、时长、数值，**熵高、几乎不可压缩**——这正是它和类名的本质区别。类名重复所以免费，props 唯一所以全价。

## 四、业内常见做法

按「改了什么」分类，收益和代价都是外部观察 + 本地模拟，不是受控实验。

| # | 做法 | 代表实现 | 省什么 | 代价 | 本仓库是否适用 |
| --- | --- | --- | --- | --- | --- |
| A | **不动，靠压缩** | 默认部署（Cloudflare 已开 zstd） | — | 无 | 已经是最优的基线 |
| B | **构建期类名重写** | [minwind](https://github.com/jonkwheeler/minwind)（MIT，Vite / webpack / post-build CLI，支持 `.astro`） | HTML raw 23%、HTML+CSS brotli 4%（作者在 ~40 个预渲染路由上的自测）；本地模拟 CSS brotli 40% | 源码与产物不一致；动态类名要么显式排除要么保持原名；调试时看到哈希 | 可以试，但见第六节的取舍 |
| C | **合并重复类串 / 组件化** | 手写语义类（`@layer components`）、`@apply`、cva 收敛 | raw 显著（本例 130 KB），压缩后很少 | 破坏「样式即类名」的直接可见性；和 `dark:` Token 规范要配合 | ✅ 比 B 更该先做 |
| D | **换风格引擎：原子短哈希** | StyleX（`.x1e2nbdu`，编译期原子 CSS）、Panda CSS（`.d_flex`、`.bg_blue.500`，[官方支持 Astro](https://panda-css.com/docs/get-started/astro)）、vanilla-extract | 每个类名 8–15 字符，样式表随原子规则去重 | 全站重写；StyleX 只走 React，覆盖不到 `.astro` 模板里的标记 | ❌ 收益配不上重写量 |
| E | **减少元素数量** | 分页、虚拟滚动、首屏 SSR + 增量加载 | 类名和 DOM 一起降，且降的是**不可压缩**的解析成本 | 功能改动 | ✅ 见 B39；`/streams` 400 行表格同理 |
| F | **属性层微调** | 短属性名、去掉引号、收敛 `style` / `data-*` | 每处几字节，压缩后 ≈0 | 可读性 | ❌ 投入产出不成比例 |
| G | **传输层** | brotli / zstd、长缓存 | 已在用 | 无 | 已完成 |

补充说明：

- **B 类工具的真实形态。** minwind 的做法是「源模块 + 产物 CSS + 产物 HTML 一起重写，重写不出来的 token 保持原名」，产出 `report.json` / `map.json`，并自带 `npx minwind measure <dir>` 只读预估。作者自测的 brotli 收益只有 4.0%，和本文 CSS 侧 40% 的差距来自站点结构（他那份 HTML/CSS 比例更高）——**说明这类收益必须按站测，不能套用别人的百分比**。
- **D 类不是「为了体积换引擎」的选项。** StyleX 的原子类是编译期按属性-值对生成的，类名短是因为「一个类只声明一条规则」，每个元素于是更多类、更短类；总的 HTML 字符数下降有限。LogRocket 用 20 个组件做迁移实测，两边 CSS 产物几乎一样（Tailwind 20,379 B vs StyleX 20,561 B）——**CSS 体积不是选引擎的理由**。
- **Astro 侧的 props 序列化是已知问题。** [withastro/astro#7978](https://github.com/withastro/astro/issues/7978) 记录的就是「props 塞进 HTML 属性导致引号转义膨胀到 6 倍」，2023 年修了最严重的那一层（重复 `JSON.stringify`），但「JSON 放属性里」这个形态保留至今。所以这不是本站写错了什么。
- **Tailwind 官方不给这个方案。** [Optimizing for Production](https://tailwindcss.com/docs/optimizing-for-production) 只讲 CSS 产物大小，不提类名长度；社区里针对「HTML 里类名太长」的讨论，结论基本都是「gzip 已经解决了」——本文的实测支持这个结论的**一部分**（HTML 侧确实如此），但 CSS 侧不是。

## 五、在本仓库的模拟收益

把「HTML + CSS 类名全部重命名」的上界效果合起来：

| 项 | raw | brotli 11 |
| --- | ---: | ---: |
| 首页 HTML | 309,877 → 270,599（-12.7%） | 24,331 → 22,290（-8.4%） |
| 站点 CSS（跨路由共享） | 282,372 → 197,497（-30.1%） | 29,987 → 17,890（-40.3%） |
| **首次访问合计** | 592,249 → 468,096（**-21.0%**） | 54,318 → 40,180（**-26.0%，省 14.1 KB**） |

分页看：

| 页面 | HTML brotli 省 | 说明 |
| --- | ---: | --- |
| `/` | 8.4%（2.0 KB） | 类名占比高 |
| `/arale/stream/*` | 3.6%（2.0 KB） | |
| `/arale/transcripts` | 2.9%（2.3 KB） | props 占了 92.5%，类名无关紧要 |
| `/arale/streams` | 3.8%（3.2 KB） | raw 省 17.3%（299 KB），对 2 MB 门限有意义 |

**要强调的边界**：CSS 是跨路由长缓存的（`inlineStylesheets: 'never'` + `/_astro/*` 一年 immutable），所以这 12 KB 只在**首次访问**付一次，二次访问收益为 0；HTML 侧则是每个页面都要付（但页面上限被边缘缓存挡掉了，真正付费的是冷路径和爬虫）。

## 六、判断

按「收益 ÷ 风险」排序：

1. **先做 props，不做类名。** `/arale/transcripts` 去掉 props 能省 85% 的压缩载荷、`/arale/streams` 省 75%——是类名方案的 10–20 倍。已是 B39，且应当从「`/gallery` 一个页面」扩展到所有把整份数据传进 `dataset-page` 的页面。
2. **消掉重复的长类串（做法 C）。** `/streams` 一条 352 字符的 `td` 类名重复 400 次 = 140 KB raw。收到 `.table-cell` 语义类后 raw 立刻降一个台阶，同时解决 Googlebot 2 MB 门限（这一条对 `/gallery` 的 2.07 MB 同样是直接解法，和 B39 正交）。压缩收益小，但 raw 收益是实打实的。
3. **类名重命名（做法 B）放最后，且只做 CSS 侧。** 唯一收益明确的半边是样式表 12 KB brotli（40%）。但 CSS 由 Tailwind 生成，重命名要同时改 HTML 和 CSS，等于自己写一个 minwind——建议先用 `npx minwind measure dist/` 拿一份只读报告，确认纸面收益再决定要不要引依赖。
4. **不要做的事**：短属性名、去引号、`@property` 裁剪、为体积换风格引擎。前三个是压缩后 ≈0，第四个是重写全站的代价换不到确定性收益。

如果只做一件事：**B39 的 props 收敛**。如果做两件：再补做法 C 的表格/列表语义类。

## 七、风险与边界

- **收益随页面结构变化。** 本文的百分比只对当前这几个页面成立，也只在当前 Tailwind 产物上成立。改版、加组件、换 utility 密度都会移动分母。
- **重命名会踩的坑**：动态拼接的类名（`` `bg-${color}-500` `` 这种）、`tailwind-merge` 运行期消解、`group/xxx` 与 `peer/xxx` 命名、`data-[...]:` / `has-[...]:` 变体、第三方库自带的类名（`lucide`、`base-ui-*`）。minwind 的处理策略是「证不出安全就保持原名」，代价是收益打折。
- **上界 vs 实际。** 本文的重命名是「每个唯一 token 一个哈希」的理想化模拟；真实工具的 HTML 侧收益会明显低于 8.4%。
- **压缩口径**。本机 `zstdCompressSync` 默认级别比 gzip 还差（CSS 40.8 KB vs gzip 39.3 KB），线上 Cloudflare 的 zstd 是另一套参数，所以本文统一用 brotli 11 做可比口径，不拿本机 zstd 数字下结论。
- **可读性成本是真的。** 生产环境里 `class="c0000f c0001a"` 会让线上排查样式问题多一步映射表查询。这是「省 14 KB」要换的东西。

## 八、来源

- [minwind](https://github.com/jonkwheeler/minwind)：构建期类名重写工具，README 自测表（raw -23.3%、brotli -4.0%、中位 class 属性 -75%）；Vite / webpack / rspack / post-build 三种接入方式；访问于 2026-11-15。
- [withastro/astro#7978](https://github.com/withastro/astro/issues/7978)：props 塞进 HTML 属性的引号转义膨胀，2023-08 记录并部分修复。
- [Optimizing for Production · Tailwind CSS](https://tailwindcss.com/docs/optimizing-for-production)：官方只讨论 CSS 产物大小，未提类名长度。
- [Tailwind CSS vs. StyleX: A real migration with 20 components](https://blog.logrocket.com/tailwind-css-vs-stylex-a-real-migration-with-20-components/)：20 组件迁移后 CSS 产物 20,379 B vs 20,561 B，接近持平。
- [Using Astro · Panda CSS](https://panda-css.com/docs/get-started/astro) / [Atomic Recipe · Panda CSS](https://panda-css.com/docs/recipes/atomic-recipe)：原子类名形如 `d_inline-flex` / `bg_blue.500`，官方支持 `.astro`。
- [A Quick Look into StyleX](https://betterstack.com/community/guides/scaling-nodejs/stylex-metas/)：原子类名形如 `.x1e2nbdu`，编译期确定性生成。
- 本站已有的体积数据与修复记录：[seo-audit-2026-11-15.md](./seo-audit-2026-11-15.md)、[long-document-rendering-practices.md](./long-document-rendering-practices.md)。

## 附录：测量脚本

不依赖仓库代码，`bun` 直接跑。三个变换分别对应 3.2 / 3.3 / 3.5 的表。

```ts
// analyze.ts <html-file> [css-file]
import { readFileSync } from 'node:fs'
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'

const br = (s: string) => brotliCompressSync(s, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).length
const stats = (s: string) => ({ raw: Buffer.byteLength(s), gzip: gzipSync(s).length, br: br(s) })

const html = readFileSync(process.argv[2]!, 'utf8')

// 1) 类名的边际成本：全部剥离
const noClass = html.replace(/\sclass="[^"]*"/g, '')

// 2) 重命名：每个唯一 token 一个 6 字符哈希
const tokens = [...html.matchAll(/\sclass="([^"]*)"/g)]
  .flatMap(m => m[1]!.split(/\s+/).filter(Boolean))
const unique = [...new Set(tokens)]
const map = new Map(unique.map((t, i) => [t, 'c' + i.toString(36).padStart(5, '0')]))
const renamed = html.replace(/\sclass="([^"]*)"/g, (_, v: string) =>
  ' class="' + v.split(/\s+/).filter(Boolean).map(t => map.get(t)).join(' ') + '"')

// 3) 剥 props：astro-island 序列化数据
const noProps = html.replace(/(<astro-island\b[^>]*?)\sprops="[^"]*"/g, '$1')

console.log(JSON.stringify({
  elements: tokens.length,
  uniqueTokens: unique.length,
  before: stats(html),
  noClass: stats(noClass),
  renamed: stats(renamed),
  noProps: stats(noProps),
}, null, 2))
```

CSS 侧同理，只是选择器正则要收紧到「前面不是数字或标识符字符」，否则会把 `0.5rem` 里的 `.5rem` 当成类名：

```ts
const CLASS_RE = /(?<![\w\d.\-%])\.(?:[A-Za-z_\\-]|\\)[\w\\:[\]().&>~=+*$%,!/'#-]*/g
```

原始 HTML / CSS 与脚本未入库：体积大、易过期，按上面的命令随时可重跑。
