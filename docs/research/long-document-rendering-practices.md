# 超长文档 / 超长列表的渲染：业界做法

> 调研日期：2026-11-09。回答一个问题：Notion、GitHub、Google Docs、Wikipedia 这类产品，面对「一屏放不下、DOM 会膨胀到几十万节点」的内容时，各自怎么保证性能；哪些做法适合本站。
> 本文只汇总外部资料与产品行为，不替本站做决定；本站的取舍见 [long-transcript-rendering.md](./long-transcript-rendering.md)。

## 一、先拆成三个成本

「长文档卡」不是单一问题，业界的方案分别针对不同成本：

| 成本 | 什么时候付 | 典型症状 |
| --- | --- | --- |
| 首次渲染 / 布局 | 打开页面时 | 白屏久、首屏 INP 差 |
| 滚动绘制 | 每次滚动 | 掉帧、吸顶栏闪烁 |
| 内存与交互 | DOM 节点多、事件多 | 输入延迟、切页后内存不降 |

同一个产品往往同时用多种手段，而不是找「银弹」。GitHub 在 2026 年的 diff 性能文章里直接写了这一点：没有单一方案，按 PR 大小分层处理。

## 二、业界在用的六条路线

### 1. 干脆不用 JS：服务端输出完整 HTML

Wikipedia、MDN、大多数博客和新闻站点属于这一类。文章正文是服务端渲染的静态 HTML，不 hydrate、不挂事件、不建虚拟列表。浏览器原生负责滚动、查找、选中、锚点与无障碍。

- 成本最低、行为最完整；
- 只适用于「正文不需要客户端交互」的场景；
- Wikipedia 的移动端另外做了一件事：**章节默认折叠**，让长条目先露出目录与首段（[MediaWiki](https://www.mediawiki.org/wiki/Readers/Reader_Growth/Expanded_Mobile_Sections)）。这是内容层方案，不是渲染层方案。

对本站的启示：逐字稿正文目前由客户端从 R2 拉取后渲染（会员限定内容不能进公开 HTML），所以拿不到「零 JS」的完整收益；但正文的交互越少越好。

### 2. CSS containment：`content-visibility: auto`

这是最便宜的渲染层优化，Baseline 2024-09 起三大引擎都支持。给分块元素加上：

```css
.chunk {
  content-visibility: auto;
  contain-intrinsic-size: auto 1000px;
}
```

- 离屏块跳过布局、样式与绘制，DOM、find-in-page、Tab 顺序、无障碍树都保留；
- 需要先**把内容切块**，并用 `contain-intrinsic-size` 撑住滚动条；
- web.dev 的旅行博客示例：首次渲染 232ms → 30ms（约 7 倍），并给出「预期减少 50% 以上」的经验值；
- 官方也提醒：对跳过子树调用强制布局 API（`offsetHeight` 等）会让优化失效。

代价是**占位高度是估算值**：滚动条会先按估算画，元素真正渲染后高度变化会造成跳动；用锚点跳转时落点也会偏。Alex Russell 专门写过「`content-visibility` without jittery scrollbars」的修正方案。

GitHub 的 diff 文章没有用它做主力（他们需要精确行高），但普通长文章、文档站适合。

### 3. 虚拟列表 / 窗口化：只挂载视口附近

把「所有内容都在 DOM 里」换成「只挂载视口附近一小段，其余用占位高度撑住滚动条」。这是超长列表（聊天记录、代码 diff、表格）的主流答案。

- **Notion（2026-10-22）** 上线页面虚拟化：以前打开页面会渲染所有 block，现在随滚动渲染；官方说内存下降、长页面更快。关键细节是**内容仍然加载在内存里**，只是不绘制离屏 block，所以 `Cmd+F` 仍能命中未滚动到的内容（[Notion 工程师说明](https://x.com/john_ryan_nyc/status/2114504879162933464)）。
- **GitHub PR diff（2026-04）** 先做组件与 DOM 精简，再对 p95+（超过 1 万行 diff）启用虚拟化：用 [TanStack Virtual](https://tanstack.com/virtual/latest)，DOM 与 JS heap 降约 10 倍，INP 从 275–700ms 降到 40–80ms。普通 PR 不做虚拟化，以保留浏览器原生查找。
- **GitHub Copilot 的百万行 PR（2026-09）** 把「已知行高的代码行」和「渲染后才知道高度的评论块」拆成两套几何：代码行精确前缀和，评论块估算后惰性测量；测量只在滚动停止后的空闲期做，且用滚动锚定（按元素身份而非像素）修正，避免边滚边改高度。
- **聊天产品**（ChatGPT 一类）普遍用 [react-virtuoso 的 message list](https://virtuoso.dev/message-list/)：虚拟化长会话、维护「贴底」、加载历史时不跳。

代价：浏览器原生 find-in-page、文本选中、锚点、焦点连续性、屏幕阅读器行为都要重新实现或接受降级。GitHub 的原文是「for most pull requests, keep expected behavior like native find-in-page; for the extreme, gracefully degrade with virtualization」。

### 4. 渐进渲染：分块、idle、IntersectionObserver

不是卸载 DOM，而是把「一次渲染整篇」改成「先渲染视口，再在空闲时补齐」。做法包括：

- 把正文切成 section / block，首帧只挂载前面几块；
- 用 `requestIdleCallback`、`scheduler.postTask` 或 `setTimeout` 分批渲染；
- 用 `IntersectionObserver` 或 `contentvisibilityautostatechange` 在接近视口时再挂载；
- React 侧对应 `Suspense` + 流式 SSR（React Server Components / Astro `server:defer`）。

它解决的是主线程长任务与首屏时间，不改变总 DOM，也不改变滚动时的绘制面积。适合「内容必须完整、但可以晚一点出现」的文档。

### 5. Canvas：不把文字放进 DOM

Google Docs 在 2021 年把渲染从 HTML 迁到 Canvas，官方理由是「提升性能、统一跨平台表现」。PDF.js 也是每页渲染到 canvas，只在页面接近视口时渲染。Figma 同类。

- 优势：文本量再大，DOM 也几乎不增长；布局、绘制全由应用控制，可以做增量重绘；
- 代价：浏览器原生查找、选中、复制、翻译、屏幕阅读器、SEO 全部要自己重建。Google Docs 的迁移当年就引发了无障碍担忧。适合「编辑器 / 查看器」类应用，不适合内容站。

### 6. 内容层：折叠、分页、目录

最后一条不是渲染技巧，而是减少「同时存在」的内容：

- Wikipedia 移动端章节默认折叠；
- AO3、Substack 一类按章节 / 分页组织长文；
- 文档站用侧边目录 + 单页滚动，靠锚点跳转；
- 编辑器用 `<details>` / 折叠块。

对阅读型页面，这往往比任何渲染技巧都有效，而且不牺牲 find-in-page（当前页内仍可用）。

## 三、案例对比

| 产品 | 主要手段 | 关键数字 / 细节 | 代价 |
| --- | --- | --- | --- |
| Wikipedia | SSR HTML + 移动端章节折叠 | 正文零 hydration；章节折叠是导航优化 | 折叠依赖客户端 JS，曾出现慢网下自动收起的问题 |
| Notion | block 虚拟化 | 2026-10 上线；内容仍在内存，find 可用 | 极长页面仍建议拆分 |
| GitHub PR diff | 组件精简 + p95+ 虚拟化 + 仅可见行 hydration + 渐进加载 | 40 万 DOM / >1GB heap → 18 万节点；虚拟化后 DOM 与 heap 约 1/10 | 普通 PR 保留原生查找，极端 PR 降级 |
| GitHub Copilot 百万行 PR | 代码行确定性几何 + 评论块动态几何 + 空闲测量 + 滚动锚定 | 代码高度前缀和精确；评论只在滚动停止后测量 | 实现复杂度高 |
| Google Docs | Canvas 渲染 | 2021 年迁移，性能 + 跨平台一致性 | 查找 / 选中 / 无障碍需重建 |
| PDF.js | 按页 canvas，视口附近才渲染 | 大 PDF 首屏只画可见页 | 同上 |
| 聊天 / AI 会话 | 虚拟列表（Virtuoso 等） | 只挂载可视消息，维护贴底与历史位置 | find-in-page 需额外处理 |

## 四、怎么选：一个粗略决策树

```text
正文需要客户端交互吗？
├─ 不需要 → SSR 完整 HTML（最省、行为最全）
└─ 需要
   ├─ 内容可以晚出现 → 分块 + 渐进渲染
   ├─ 只是首次布局重 → content-visibility（先切块，注意占位与锚点）
   ├─ 内容量本身失控 → 折叠 / 分页 / 目录
   └─ 真的是几十万行、必须一次可滚
      ├─ 需要原生查找 / 选中 → 尽量优化 + 只在极端情况虚拟化（GitHub 路线）
      └─ 不需要 → 虚拟列表；再极端 → Canvas
```

几条跨案例都成立的判断：

1. **先量再选**：GitHub 的结论来自 INP、heap、DOM 计数；没有数字的「优化」很容易选错层。
2. **分层处理**：常见情况保留原生行为，极端情况才降级；不要为 p99 让所有人付复杂度。
3. **虚拟化的隐藏成本在「行为」**：find-in-page、锚点、选中、焦点、屏幕阅读器；Notion 选择「内容仍在内存、只是不画」，GitHub 选择「普通 PR 不虚拟化」。
4. **滚动锚定是虚拟化的难点**：高度测量必须离开滚动热路径，修正要按身份而不是像素（GitHub Copilot 文章的详细结论）。
5. **内容层手段优先**：能少展示一半内容，比任何渲染技巧都直接。

## 五、对本站的适用性

- 本站逐字稿是**阅读型内容**，不需要编辑；正文由会员访问控制决定，不能直接进公开 HTML。
- 已采用内容层方案：附录中日对照**默认只挂载中文**，正文高度约减半（见 [long-transcript-rendering.md](./long-transcript-rendering.md)）。
- **不建议虚拟化**：逐字稿依赖浏览器内查找与标题锚点，虚拟化会把这两件事变成自建能力；且本站没有 GitHub 那样的 p95 极端流量压力。
- 如果未来仍需压缩：优先章节折叠 / 分页，其次 `content-visibility`（需同时解决锚点占位），最后才考虑虚拟列表。
- 常驻栏不要用 `backdrop-filter`：这是 Chromium 的合成层缺陷，和文档长度无关，但长页面会把问题放大。

## 来源

- [web.dev — content-visibility: the new CSS property that boosts your rendering performance](https://web.dev/articles/content-visibility)（2020-08，2025-09 更新）
- [MDN — content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility)
- [Notion page virtualization（2026-10-22）](https://notioncoach.com/feed/notion-page-virtualization-faster-long-pages) 与 [John Ryan 关于 find-in-page 的说明](https://x.com/john_ryan_nyc/status/2114504879162933464)
- [GitHub — The uphill climb of making diff lines performant](https://github.blog/engineering/architecture-optimization/the-uphill-climb-of-making-diff-lines-performant/)（2026-04）
- [GitHub — Rendering huge pull requests in the GitHub Copilot app](https://github.blog/engineering/user-experience/rendering-huge-pull-requests-in-the-github-copilot-app/)（2026-09）
- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [react-virtuoso / Virtuoso Message List](https://virtuoso.dev/message-list/)
- [MediaWiki — Expanded Mobile Sections](https://www.mediawiki.org/wiki/Readers/Reader_Growth/Expanded_Mobile_Sections)
- [Google Docs Switching From DOM to Canvas（Michael Tsai 汇总 Google 公告）](https://mjtsai.com/blog/2021/05/13/google-docs-switching-from-dom-to-canvas/)
- [PDF.js 渲染管线（DeepWiki）](https://deepwiki.com/mozilla/pdf.js/3.2-page-rendering-pipeline)
- [Alex Russell — content-visibility without jittery scrollbars](https://infrequently.org/2020/12/content-visibility-scroll-fix/)
