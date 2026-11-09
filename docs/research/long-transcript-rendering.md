# 长逐字稿的渲染与滚动性能

> 现象：3,000–4,000 行的逐字稿（Markdown 约 250 KB）渲染后页面高 11.7 万 px（390px 视口下 17 万 px），滚动卡顿，固定栏与吸顶栏一起闪烁。
> 调研与实测日期：2026-11-09。外部资料与「本仓库实测」分开写，实测只代表本机 Chromium。

> 业界（Notion、GitHub、Google Docs、Wikipedia 等）如何应对同类问题的横向调研见 [long-document-rendering-practices.md](./long-document-rendering-practices.md)；本文只记录本站这一页的取舍。

## 一、先分清两件事

| 症状 | 根因类别 | 本机数据 |
| --- | --- | --- |
| 滚动卡顿 | 绘制/光栅面积随文档长度增长 | 正文 1540 个 `<p>`、492 个 `<blockquote>`；页面高 117,009px（桌面）/ 169,788px（390px） |
| 其他组件闪烁 | 合成层与 `backdrop-filter` 的边缘处理 | 顶栏 `sticky + z-index + backdrop-blur`，移动端标签栏 `fixed + backdrop-blur-xl` |

两件事要分开修：压缩正文不会消除闪烁，去掉模糊也不会减少整篇正文的绘制量。

## 二、为什么整篇正文会变慢

`react-markdown` 只能把整篇 Markdown 解析成完整的 hast，再一次性生成整棵 DOM。remark 维护者明确说过：

- 解析需要完整文档（引用式链接等语法存在前向查找），不能只解析视口附近；
- 渲染开销由 React 与浏览器承担，remark 不控制；
- 大文档的可行方向是分块后做渲染层优化，而不是改解析器。

浏览器侧的成本来自三处：块级节点数量、滚动时新瓦片的光栅化、吸顶/固定层的逐帧重新合成。

## 三、内容优化：默认只看中文

逐字稿的主体不是分析，而是「中日对照字幕附录」：本场 3,741 行里有 3,615 行是附录。附录是固定格式：

```md
## 附录：中日对照字幕

### ① 小节标题（00:00:00–00:00:00）

**（a）00:02:46 小标题**

> 日语原文

中文译文
```

主要读者看中文，日语只在需要核对原文时才用。按「双语 / 中文 / 日文」在客户端只挂载当前语言，默认中文：

| 模式 | 页面高度（本机 1440px） | 附录引用块 |
| --- | ---: | ---: |
| 中文（默认） | 66,585px | 6（只剩正文里的引用） |
| 日文 | 84,891px | 492 |
| 双语 | 113,025px | 492 |

这是本轮最有效的改动：默认中文把正文高度减少约 42%，且不需要虚拟列表。附录改为结构化渲染后，也不再需要 `react-markdown` 解析这 3,600 行。

## 四、`content-visibility: auto`：评估过，但没有采用

`content-visibility: auto` 会跳过离屏子树的布局、样式与绘制，DOM、find-in-page、Tab 顺序与选中都保留，`contain-intrinsic-size: auto <length>` 用占位高度撑住滚动条（Baseline 2024-09）。

问题在锚点。跳过的块只有估算高度，`scrollIntoView` 会按估算值定位：

- 用固定占位高度把 3,741 行切成 21 块，跳到第 70% 的标题，落点偏差 **−3,438px**；
- 目录跳转前先强制渲染目标上方的块，再把实测高度写回占位，落点可以回到 80px；
- 但强制渲染 / 恢复跳过状态的过程中，浏览器对 `contain-intrinsic-size: auto` 的「记住上次尺寸」并不稳定，平滑滚动会停在错误位置（实测偏差 264px），只能改用瞬时滚动；
- 本机滚动 trace 里，开启 `content-visibility` 的 `RasterTask` 并没有下降（164.8ms vs 161.3ms），反而因为逐块渲染出现 40ms 级长帧。

结论：它省的是**首次布局**，不是线性阅读时的滚动光栅；还会让目录跳转变脆。记录在案，不作为本页方案。

## 五、`backdrop-filter` 的闪烁不是本仓库的 bug

Chromium 已知问题：

- 固定/吸顶元素加 `backdrop-filter: blur()` 时，滚动会出现边缘色块闪烁（issues.chromium.org/339841685）；
- `position: sticky + z-index + backdrop-filter` 的元素在滚动容器里会被提升为合成层并闪烁（issues.chromium.org/497855639）；
- 机制：模糊在图像边缘需要知道元素外的像素，Chrome 采用「边缘像素无限延伸」策略，1px 滚动就会改变边缘像素，整块模糊结果跟着跳色。Firefox / Safari 没有同样明显的现象。

本仓库的处理：常驻栏（应用顶栏、组顶栏、移动端标签栏）不再使用 `backdrop-filter`，改为实色语义 Token 背景。HIG 的导航栏在内容滚动时本来也会转为不透明，层级仍由亮度区分。

## 六、其它方案与取舍

| 方案 | 收益 | 代价 | 结论 |
| --- | --- | --- | --- |
| 附录按语言只挂载当前语言 | 默认中文正文少约 42%；不再解析 3,600 行 Markdown | 需要固定格式与结构化渲染；作者要遵守格式 | **采用** |
| 移除常驻栏 `backdrop-filter` | 消除闪烁；每帧少一次背景采样与模糊 | 视觉从毛玻璃变成不透明 | **采用** |
| 正文分块 + `content-visibility: auto` | 降低首次布局 | 目录锚点会漂；线性滚动无光栅收益 | 不做 |
| 正文虚拟列表 | DOM 与视口成正比 | 浏览器内查找失效，锚点/选中/焦点要重建 | 不做 |
| 把逐字稿拆页 / 折叠章节 | 页面极短 | 改变阅读与检索方式，属于产品决策 | 不做 |
| `overflow-wrap: anywhere` → `break-word` | 减少内在尺寸计算 | 长串 URL 可能溢出；收益不确定 | 暂不做 |

## 七、附录语言筛选的交互

- **全局开关**：正文摘要下方一行「附录字幕：双语 / 中文 / 日文」，用 `SegmentedControl`；写入 `localStorage`（`yumemita-dashboard-subtitle-mode`），默认 `中文`。
- **逐条对照**：中文模式下每条字幕标题右侧有一个小按钮 `原文`，点开后只对这一条追加日语；日文模式下按钮是 `译文`。按钮带 `aria-pressed`，切换全局模式后逐条状态自动作废。
- **实现边界**：只有「附录」二级标题之后、符合 `**（x）时间 标题**` + `> 日语` + `中文` 结构的条目才走结构化渲染；格式不成立时整篇仍按普通 Markdown 渲染，开关不出现。
- 附录标题仍由 `extractToc` 生成 id，结构化渲染的 `h3` 回填同一份 id，目录跳转不受影响。

## 八、验证方式

```bash
bun run check
bun run build
```

手工走查（`bun run dev` 或 `bun run preview`）：

- 打开 `/{datasetId}/stream/{videoId}?view=transcript`，默认「中文」，附录里只有中文译文；切到「双语」出现日语原文，切到「日文」只留日语；
- 刷新后保持上次选择；逐条「原文 / 译文」只影响当前条，切换全局模式后复位；
- 目录点击附录小节标题，落点在顶栏下方；
- 390px 视口无横向溢出，底部标签栏滚动时不再闪烁。

限制未验证：真实 GPU / 高 DPI / 低端手机上的闪烁与帧率。本机 headless Chromium（SwiftShader）复现不出闪烁，只能从机制与 Chromium issue 推断。

## 来源

- [content-visibility — the native virtualization you're not using](https://subhsen.dev/blog/content-visibility-deep-dive)（2026-05）
- [Making a long list fast: content-visibility vs. virtualization](https://web-standards.dev/news/2026/08/content-visibility-vs-virtualization/)（2026-08）
- [MDN — content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility)
- [MDN — contain-intrinsic-size](https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size)
- [react-markdown 大文本性能讨论（remarkjs #1027）](https://github.com/orgs/remarkjs/discussions/1027)
- [Chromium issue 339841685 — backdrop-filter 滚动闪烁](https://issues.chromium.org/issues/339841685)
- [Chromium issue 497855639 — sticky + z-index + backdrop-filter 闪烁](https://issues.chromium.org/issues/497855639)
- [On that flickering blur in Chrome](https://jameshfisher.com/2024/04/23/backdrop-blur-without-the-flickering/)
- [CSS Backdrop-Filter Performance in 2026](https://www.maviklabs.com/blog/performance-with-backdrop-filter-2026/)
