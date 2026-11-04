# 弹幕与事件可视化组件方案

本文定义「单场弹幕 / 事件时间线」组件的目标形态、数据契约、交互与性能要求。当前 `/dev/live-chat` 是 POC，只用于验证数据能怎么展示，不是正式页面；组件化、数据源和正式入口都要重新设计。

数据字段以 [data/chat-events.md](../data/chat-events.md) 为准。

## 1. 目标与边界

目标：

- 在一个屏幕里看完一场直播的弹幕、SC、贴纸、会员、赠送会员与主播操作。
- 支持按类型、作者、事件和关键字筛选，能跳到某条消息并查看原始记录。
- 几千到几万条消息下滚动不卡，DOM 行数保持有界。
- 同一套组件能用于单场分析、内部预览和未来的 `?view=chat` 子视图。

非目标：

- 不做实时弹幕墙、发送弹幕、 moderation 或用户系统。
- 不把全量弹幕塞进首页或列表页。
- 不在生产环境读本地文件或暴露 `/dev` 路由。
- 不替代 `?view=words` 的词频、发言者与付费汇总；它是完整时间线。

## 2. 当前 POC

入口：`/dev/live-chat`，仅 `astro dev` 可用；生产构建返回 404，`noindex`，不进导航与 sitemap。

| 能力 | 当前实现 | 备注 |
| --- | --- | --- |
| 会话选择 | 读 `temp/youtube-live` 下的会话 | 默认最新，支持最近 50 个 |
| 数据读取 | `astro.config.mjs` 的 Vite 中间件 `/dev/live-chat-data` | workerd 没有宿主文件系统，读文件放在 Node 侧 |
| 消息 / 事件 | 渲染全部行 | 73 条等待室、6,012 条回放都验证过 |
| 筛选 | 全部 / 文字 / 付费 / 会员 / 事件 / 主播 | 无 URL 状态 |
| 搜索 | 作者、正文、事件类型、投票选项 | 每次输入重算，未做索引 |
| 表情 | dataset 索引 + InnerTube fallback | 支持 `:Name:` 快捷键 |
| SC | 实际 ARGB 颜色 + 金额等级回退色 | 旧档没有颜色时按金额近似 |
| 贴纸 | 图片 + 名称 + 金额 | 旧档没有 `sticker` 时显示 `[贴纸]` |
| 投票 | 合并快照，显示选项、百分比、票数元数据 | 保留更新次数与更新时间 |
| 原始数据 | 每行单独展开 | 不一次性渲染所有原文 |
| 虚拟化 | 自研 `VirtualList`，ResizeObserver 测高 | 6,012 条时 DOM 约 10 行 |
| 导入 | 文件选择器解析 `.jsonl` | 自动区分消息 / 事件；无 dataset 时按表情 id 推断 |

POC 文件：

- `src/pages/dev/live-chat.astro`
- `src/components/dev/live-chat-preview.tsx`
- `src/components/dev/live-chat-preview-loader.tsx`
- `src/components/dev/virtual-list.tsx`
- `src/lib/live-chat-preview.ts`
- `scripts/lib/live-chat-preview-data.ts`
- `astro.config.mjs` 的 `liveChatPreviewPlugin`

## 3. 数据契约

### 3.1 输入

POC 的输入是 `PreviewData`：

```ts
interface PreviewData {
  root: string
  sessions: PreviewSessionMeta[]
  session: PreviewSession | null
  error: string | null
}
```

`PreviewSession` 包含 `rows: PreviewRow[]`、`counts`、`emojiAssets` 与会话元信息。`PreviewRow` 是消息或事件的联合类型，字段与 [chat-events.md](../data/chat-events.md) 对齐。

| 组件需要的字段 | 来源 |
| --- | --- |
| 消息正文、作者、`authorId`、徽章、`kind`、金额 | `danmaku_*.jsonl` 的 `msg` |
| SC / 贴纸颜色 | `msg.colors` |
| 贴纸图片 | `msg.sticker` |
| 会员文案 | `msg.header` / `msg.membershipPrimary` / `msg.memberMessage` |
| 表情 id | `msg.emoji` |
| 事件类型、`owner`、`text`、`data` | `events_*.jsonl` |
| 表情名称 / 图片 | `emoji_<videoId>.json` + `emojis/<dataset>/index.json` |

### 3.2 正式页面的数据来源

pack 的 `chat` 只有聚合、Top 列表、主播发言和事件，**没有全量消息**。正式组件必须确定完整消息的来源：

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| R2 存 `danmaku_<videoId>.jsonl`，请求时流式读取 | 不改数据库；对象不可变；可按字节缓存 | 需要新的公开 / 签名读取接口；分页与范围请求要设计 |
| 入 `chat_events` 分区表（backlog B6） | 可按时间、作者、类型查询；与现有 DB 查询层一致 | 写入量大；需要分区、索引与保留策略 |
| 只展示聚合 + `ownerChats` + `events` | 改动最小 | 看不到普通观众消息，不满足「完整时间线」 |

在数据源确定前，正式组件不要默认从 pack 里取全量消息。

## 4. 信息架构

```text
┌ 会话头：标题 / videoId / 成员 / 状态 / 开播时间 / 数据范围
├ 统计条：消息 / 事件 / 作者 / 主播 / 表情 / 时间跨度 / 首末条
├ 事件构成：byKind + byEvent 徽章
├ 工具栏（sticky）：类型筛选 / 搜索 / 只显示主播 / 排序 / 导出 / 导入
├ 时间线（虚拟滚动）：消息行 / 事件行 / 主播行
└ 行详情：原始 JSON / 投票选项 / 被删消息 / 贴纸
```

原则：

- 时间线是主视觉，统计条与筛选不能抢过它。
- 事件行与消息行必须有明显但克制的区分；主播行单独着色。
- 长时间线用「时间 + 开播后偏移」定位，SC / 事件保留绝对时间。
- 行详情按需展开，不在首屏渲染全部 `raw`。

## 5. 行类型与视觉

| 行 | 视觉 | 必须显示 | 备注 |
| --- | --- | --- | --- |
| 文字 | 普通行 | 时间、作者、徽章、正文、表情 | 纯表情行显示图片，不显示空白 |
| 会员留言 | 普通行 + `会员留言` 徽章 | 正文、会员文案 | `kind: text` + `memberMessage` |
| SC | 等级色左边框 + 金额 chip | 金额、留言、作者、颜色 | 颜色不能是唯一信号 |
| 贴纸 | 缩略图 + 名称 + 金额 | 图片、金额 | 图片加载失败显示 `[贴纸]` |
| 会员里程碑 | 弱化行 | `header` / `membershipPrimary` | 不进入普通正文 |
| 赠送会员 | 弱化行 | 个数、赠送方、公告原文 | 单价不可得 |
| 领取赠礼 | 弱化行 | 领取方、赠送方 | pack 里并入 `membership` |
| 置顶 | 事件行 + 置顶标记 | 被置顶作者、正文 | 主播操作 |
| 投票 | 事件行 + 选项条 | 问题、选项、百分比、票数、更新时间 | 只显示最后一次快照 |
| 删除 | 事件行 + tombstone | 目标 id、可用的被删作者/正文 | 不删除原消息 |
| 系统 / 模式变更 | 弱化事件行 | 系统文案 | 不进入词频 |
| Q&A / 商品 | 事件行 | 问题 / 回答 / 商品文案 | 主播操作 |

### 5.1 SC 颜色

- 优先使用 `msg.colors` 的 ARGB：`headerBackground` 做等级色，`headerText` 做 chip 文字，`bodyBackground` / `bodyText` 做正文底色，`authorName` 做作者名。
- 旧档没有颜色时按金额给近似等级色；等级色表放在一个模块里，不散落在组件中。
- 颜色只做辅助：金额、`Super Chat` 标签和等级文本必须同时存在。色弱 / 深色模式下仍能分辨。
- 深色模式下不要直接用浅色 `bodyBackground` 铺满整行；优先用左边框 + chip，正文保持可读。

### 5.2 表情

- 图片优先用 dataset 索引路径 `<base>/emojis/<folder>/<hash>.png`；失败退回 `emoji_<videoId>.json` 的 InnerTube 地址；都失败显示名称或 `[表情]`。
- 文本里的 `:Name:` 按索引名称替换；大小写不敏感。
- 图片有 `alt` / `title`，纯装饰表情不重复读屏。
- 索引请求失败时降级为 id / 名称，不阻塞消息渲染。
- 浏览器直接请求对象存储的索引 JSON 可能被 CORS 挡住；POC 走同源 `/dev/live-chat-emoji-index`，正式组件应走同源代理或服务端读取。

### 5.3 投票

- 本地事件文件保留每次快照；组件按 `pollKey` 合并，选项与百分比取最后一次。
- 显示 `metadata` 里的票数、`snapshotCount` 与 `updatedAt`，让读者知道结果不是实时的。
- 百分比条以 100% 为满宽，保留一位小数；没有百分比时显示 `—`。
- 不在客户端重新计算票数，避免和平台口径不一致。

## 6. 交互

### 6.1 筛选与搜索

- 类型：全部 / 文字 / 付费 / 会员 / 事件 / 主播。
- 事件类型二级筛选：置顶、投票、Q&A、商品、系统、删除等。
- 搜索：作者、`authorId`、正文、事件类型、投票选项与 `data` 文本。
- 排序：默认时间升序；可切降序；事件与消息共用一条时间轴。
- 只显示主播：等价于 `owner` 筛选。
- 筛选结果计数显示「当前 / 全部」，空结果给出清除筛选的入口。

### 6.2 URL 状态

正式页面应把筛选写进 URL，默认值不写：

```text
/<datasetId>/stream/<videoId>?view=chat&kind=paid&q=おめでとう&owner=1&t=1234
```

- `kind`、`q`、`owner`、`t`（定位到某条消息的时间）可分享、可刷新。
- 切换场次或返回时保留筛选，除非用户清除。
- POC 目前没有 URL 状态，正式化时补。

### 6.3 行操作

- 复制消息深链：`?view=chat&t=<ts>`，打开后滚动到该行并高亮。
- 复制原始 JSON；只复制当前行，不导出全部。
- 导出当前筛选结果为 JSONL / CSV；导出前确认条数与大小。
- 跳到 YouTube 原片：用 `ts - startedAt` 生成 `t=` 参数；开播前消息不生成跳转。
- 键盘：`j` / `k` 上下移动，`/` 聚焦搜索，`f` 切筛选，`Esc` 清搜索 / 关闭详情，`Home` / `End` 到首末条。

## 7. 性能与虚拟化

### 7.1 要求

- 10,000 条消息下滚动不掉帧；DOM 行数保持在视口 + overscan 范围。
- 行高可变（换行、投票选项、贴纸、原始 JSON 展开），不能假设固定高度。
- 搜索 / 筛选不阻塞输入；大文件导入不阻塞主线程。
- 原始 JSON 只在展开时渲染；不要为每行常驻 `JSON.stringify`。
- 首屏只渲染视口附近；统计与筛选独立于时间线。

### 7.2 POC 的虚拟列表

`src/components/dev/virtual-list.tsx`：

- 只渲染 `[scrollTop - overscan, scrollTop + viewport + overscan]` 的行；
- `ResizeObserver` 实测行高，更新高度数组后重算偏移；
- 外层容器固定高度，内部 `ol` 用绝对定位 + `top` 放置行；
- 过滤条件变化时由调用方 `key` 重新挂载，重置高度与滚动。

已知限制：

- 行高变化会让滚动位置轻微跳动，未做锚点补偿；
- 每次滚动都会 re-render 可见行，未做 `startTransition`；
- 搜索每次输入都重算 `searchText`，没有倒排索引 / 防抖；
- 没有分页或「跳到时间」，只靠滚动条。

正式化时可以继续维护这套实现，或换成成熟的 virtualizer；选型标准是可变行高、测量、锚点与键盘支持，不引入只支持固定行高的方案。

## 8. 导入 JSONL

POC 的导入用于本地调试，正式组件可以保留为「打开本地文件」：

- 接受 `.jsonl` / `.json` / `.txt`；逐行解析。
- 自动区分：有 `msg` 对象的是消息；有 `at` + `type` 的是事件。
- 合成会话元信息：文件名做 id，首条消息的 `video` 做 videoId，`datasetId` 从表情 id 的频道 scope 推断。
- 表情名称 / 图片仍走 dataset 索引；没有索引时显示 id / `[表情]`。
- 单行失败不阻塞其他行；显示坏行数。
- 大文件（> 10 MB）在 Worker 中解析，或提示用户先按场次拆分。
- 导入数据只存在内存，不写数据库、不上传对象存储。

## 9. 状态

| 状态 | 表现 | 下一步 |
| --- | --- | --- |
| loading | 骨架行 / 读取提示 | 等待数据 |
| empty | 没有会话或没有匹配记录 | 选择会话 / 清除筛选 |
| error | 读取或导入失败的原因 | 重试 / 换文件 / 检查路径 |
| partial | 坏行、缺事件、缺表情索引 | 显示数量；不阻塞其余行 |
| degraded | 旧档没有 SC 颜色 / 贴纸 / 会员文案 | 用回退样式；提示「重抓可补全」 |

## 10. 可访问性与设计 Token

- 颜色全部用 `src/styles/app.css` 的 Token；SC 等级色是数据，集中在一个模块里，不散落硬编码。
- 不用颜色作为唯一区分：SC 有金额和标签，事件有类型文字，主播有「主播」徽章。
- 行用 `<ol>` / `<li>` 语义；筛选按钮用 `aria-pressed`；计数变化用 `aria-live="polite"`。
- 图标按钮有 `aria-label`；表情 / 贴纸有 `alt`；时间链接说明跳转目标。
- 焦点环可见；`prefers-reduced-motion` 下不做入场动画。
- 320 / 390px 无横向溢出；投票条、贴纸、原始 JSON 在窄屏内换行或自身滚动。

## 11. 正式化路径

1. **抽出共享视图模型**：把 POC 的 `PreviewRow` / `PreviewSession` / 事件合并逻辑移到可复用模块，补单元测试。
2. **确定全量消息数据源**：R2 `danmaku_*.jsonl` 或 `chat_events` 表（B6）；同时定义分页 / 范围读取与缓存策略。
3. **组件拆分**：`ChatTimeline`、`ChatRow`、`ChatToolbar`、`ChatStats`、`ChatSessionPicker`、`ChatImport`、`PaidChatCard`、`PollCard`、`EventCard`、`ChatDetail`。
4. **接入正式路由**：优先做 `/<datasetId>/stream/<videoId>?view=chat`；未完成前只保留 `/dev/live-chat` 内部入口。
5. **补质量门禁**：虚拟列表性能测试、筛选 / 搜索单测、导入坏行测试、320 / 390px 走查、深色模式与 axe 检查。
6. **安全与发布**：生产不读本地文件；导入内容按纯文本渲染；不把内部预览路由放进 sitemap / 导航。

验收标准：

- [ ] 10,000 条消息下滚动流畅，DOM 行数有界。
- [ ] 搜索 / 筛选 100 ms 内给出结果；空结果有清除入口。
- [ ] SC 颜色、贴纸、会员留言、投票、置顶、删除都有正确回退。
- [ ] 表情索引失败时仍能显示名称 / id，不出现空白行。
- [ ] 导入 1 万行 JSONL 不阻塞输入，坏行有计数。
- [ ] 320 / 390px、浅色 / 深色、键盘与 200% 缩放通过。
- [ ] 生产环境没有 `/dev/live-chat` 数据接口与本地文件读取。

## 12. 未决问题

- 全量弹幕放 R2 还是 `chat_events` 表？保留多久？
- 是否展示被删除消息的正文？当前策略是保留原记录并追加 tombstone。
- 等待室是否作为时间线的独立阶段显示？现在只按时间排序。
- 投票只显示最后一次快照，还是提供「历史快照」切换？
- 是否需要按分钟聚合的「概览 / 明细」双模式，避免一上来就是几万行？
- 导出格式：JSONL、CSV，还是只提供当前筛选的复制？
- 虚拟列表继续自研还是引入成熟库？选型时优先看可变行高与可访问性。
