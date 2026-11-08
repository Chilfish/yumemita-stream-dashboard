---
审查日期: 2026-11-08
审查范围: 全仓库隐式状态机（`src/` 服务端与岛屿、`scripts/` 数据管线、路由与配置）
审查方式: AI 静态审查（多轴：数据 / 授权 / 缓存 / 交互 / 管线）
分支: main
---

# 项目审查记录（2026-11-08）：隐式状态机

> 本档盘点代码里没有显式建模、由字段组合、布尔值或时间推导出来的状态机。问题清单按 Z / R / E / U 分级，承接项登记在 [planning/backlog.md](../planning/backlog.md) 的「审查承接区」，实施计划见 [state-machine-remediation.md](../planning/state-machine-remediation.md)。

## 〇、总评

全站的行为状态大多没有落库或收敛成联合类型。一个「状态」通常是若干可空字段、两个布尔值、一个时间戳与 `Date.now()` 的组合，每个读取方各自重新推导一次。这带来两类后果：

- 同一事实在不同页面、不同 API、不同脚本里得出不同答案，且没有单一位置可以修改。
- 非法状态可以表示出来，部分已经可达（授权绕过、缓存假成功、永久跳过）。

本次按四层登记 74 条状态机（跨层有重复条目，正文已标注）。其中真正造成行为缺陷的集中在授权、缓存与生命周期三处，工程和 UI 层多为一致性债务。

### 分维度评分

| 维度 | 评分 | 一句话 |
| --- | --- | --- |
| 数据与回退 | ⭐⭐ | 三态覆盖基本到位，但 `null` / `0` / 被屏蔽值混用 |
| 授权与安全 | ⭐ | 会员限定有多份实现，且能在查询失败时被跳过 |
| 缓存与失效 | ⭐⭐ | tag 词表三方漂移，purge 把「未执行」报成成功 |
| 交互状态 | ⭐⭐ | URL 是状态源，但存在多写竞争与派生重置 |
| 管线一致性 | ⭐⭐ | 幂等以文件存在为准，负缓存没有过期 |
| 文档与规范 | ⭐⭐⭐ | 分层与写作规范清楚，本文按既有索引登记 |

## 一、审查范围与方法

已读范围：

- 服务端与数据：`src/db/schema.ts`、`src/db/queries/*`、`src/lib/{calendar,schedule,visibility,member-access,transcripts,group,group-home,compare,aggregate,page,media}.ts`、`src/types/*`。
- 客户端与岛屿：`src/components/admin/*`、`src/components/dashboard/calendar/*`、`src/components/dashboard/streams/*`、`src/components/dashboard/transcript/*`、`src/components/dashboard/shell/*`、`src/components/shared/{ThemeProvider,router-compat}.tsx`、`src/hooks/*`、`src/lib/{router-state,router-compat,preferences,table-params,gallery-params,compare-params,calendar}.ts`、`src/stores/appConfig.ts`。
- 数据管线：`scripts/fetch-streams.ts`、`fetch-danmaku.ts`、`fetch-live-chat.ts`、`ingest-db.ts`、`daily-update.ts`、`publish-data.ts`、`publish-transcripts.ts`、`verify-*.ts`、`backfill-owner-chats.ts`、`scripts/lib/{live-chat-collect,update-plan,publish-state,purge,yt-cookies,schedule-sync}.ts`。
- 请求层：`src/middleware.ts`、`src/worker.ts`、`src/lib/{admin-auth,object-read,routes,local-url}.ts`、`src/pages/api/**/*.ts`、`src/pages/[datasetId]/stream/[videoId].md.ts`、`src/pages/{sitemap.xml,llms.txt}.ts`、`src/pages/[datasetId]/*.astro`。

方法：先按「状态集合 → 转移触发 → 编码方式 → 风险」四段读每个候选；再横向核对同一规则在不同文件里的实现是否一致。本文只记录事实与可复现的条件，不修改代码。

## 二、三个系统性模式

### 2.1 生命周期由可空字段与当前时间推导

除了 `ingest_reports.status`，数据库里没有状态列。日历场次、场次入库完整度、逐字稿可用性、R2 对象可用性都靠「哪些字段为空 / 有没有对应行」在请求期重新计算。

代表：`deriveCalendarEventState`（`src/lib/calendar.ts`）用 `cancelled_at`、`last_live_at`、`hasStream` 与 `now` 生成 6 个状态；`resolveScheduleTiming` 用 `scheduled_at` / `date` / `slot` 的填充情况生成 4 种时间状态。

后果：状态不可审计，缓存页面是某个时刻的快照，管理员与公开页面对同一行可能给出不同状态。

### 2.2 用布尔组合代替联合类型

授权、缓存策略、编辑流程、加载状态都写成多个布尔的笛卡尔积。中间态可以共存，非法组合可以出现。

代表：`middleware.ts` 的 6 种鉴权结果由「环境变量是否配置 / cookie 是否有效 / Basic 是否有效 / Origin 是否存在」四个布尔内联判断；`schedule-editor.tsx` 的 `editingKey`、`saving`、`error`、`deleteTarget` 可同时存在；`share-button.tsx` 用 5 个独立字段表达导出流程。

### 2.3 同一条规则有多份实现

同一业务规则在不同层各写一遍，已经出现用户可见的矛盾。

| 规则 | 实现处 | 已知分歧 |
| --- | --- | --- |
| 会员限定屏蔽 | `db/queries/shared.ts` 的 `maskMemberOnlyMetrics`、`lib/group.ts` 的 `toGroupStream`、`queries/group.ts` 的 SQL、`queries/dataset-totals.ts`、`queries/group-compare.ts` | 同一成员在组首页与对比页的 `streamCount` 分母不同 |
| 逐字稿授权 | `queries/transcripts.ts`、`api/transcripts/*`、`[videoId].md.ts`、`[videoId].astro` | API 在 `getStream` 失败时跳过门禁 |
| `live` 判定 | `deriveCalendarEventState` 用 24 小时；`upcomingEvents` 用 12 小时 | 一个事件可以同时「直播中」且不在「接下来」 |
| v1 / v2 默认 | `dataset-totals.ts` 把空 schema 当 v1；`packs.ts` 把空 schema 当 v2 | 同一行在单场页与汇总页口径相反 |
| 「已发布 / 未变化」 | `publish-state.ts` 比较本地摘要与远端大小 | `--adopt-remote` 只记成功不写记录，同尺寸变更永远不可见 |

## 三、状态机清单

### 3.1 服务端与领域（D）

| 编号 | 状态机 | 状态 | 编码方式与位置 |
| --- | --- | --- | --- |
| D01 | 日历事件生命周期 | cancelled / done / live / upcoming / pending / undated | `cancelled_at`、`last_live_at`、`hasStream`、`now`（`src/lib/calendar.ts` `deriveCalendarEventState`） |
| D02 | 日程身份与晋级 | `manual:` 行 / `yt:` 行 / 合并行 / 已删除 | `event_key` 前缀 + `source` + `video_id`（`src/db/schema.ts`、`src/lib/schedule.ts`、`src/pages/api/admin/schedule.ts`） |
| D03 | 日程时间精度 | 精确 / 时段推定 / 仅日期 / 无日期 | `scheduled_at`、`date`、`slot` 的填充组合（`src/lib/schedule.ts` `resolveScheduleTiming`） |
| D04 | 日历合并与优先级 | stream > youtube > manual；已匹配即隐藏 | `SOURCE_PRIORITY` + 每次请求重建的 `Map`（`src/lib/calendar.ts` `matchSchedulesToStreams`） |
| D05 | 会员限定可见性 | 公开 / 会员限定 × 已解锁 / 未解锁 × 可缓存 / 不可缓存 | `availability` 文本 + `?key=`（`src/lib/visibility.ts`、`src/lib/member-access.ts`） |
| D06 | 逐字稿可用性 | 缺失 / 待发布 / 可用 / 受限 / 孤儿 | `transcripts` 行是否存在 + 与 `streams` 的内连接（`src/db/queries/transcripts.ts`） |
| D07 | 数据包版本与聚合覆盖 | v1 / v2 / 混合；top-lists / partial / full | `schema` 后缀 + 可空 `public_totals`（`src/lib/aggregate.ts`、`src/db/queries/dataset-totals.ts`） |
| D08 | 「未抓到」与零值 | 未抓到 / 真零 / 被屏蔽 | SQL `NULL`，各消费方用不同规则解码（`src/db/queries/packs.ts`、`src/lib/group-home.ts`、`src/lib/compare.ts`） |
| D09 | 场次入库完整度 | 仅开始 → 有时长 → 有弹幕 → 有明细 → 有评论 → 有 VSTATS | 列是否为空，没有状态列（`src/db/schema.ts`） |
| D10 | 组成员存在性 | focus / rest / idle / missing | `latest === null`（`src/lib/group-home.ts`、`src/lib/group.ts`） |
| D11 | ingest 报告生命周期 | running / success / partial / failed | `status` 文本 + 可空 `finished_at`（`src/db/schema.ts`） |
| D12 | 日历查询收录阶梯 | 日期命中 / 无日期但时间命中 / 完全无日期 / 范围外 | 三分支 `or(...)`（`src/db/queries/calendar.ts`） |

### 3.2 客户端与岛屿（C）

| 编号 | 状态机 | 状态 | 编码方式与位置 |
| --- | --- | --- | --- |
| C01 | 日程编辑器模式 | create / edit / saving / error / delete-confirm | `editingKey`、`saving`、`error`、`deleteTarget`（`src/components/admin/schedule-editor.tsx`） |
| C02 | 日程时间输入 | 时段 / 精确时间（两个字段同时有值） | `timeMode` 覆盖并行的 `slot` 与 `time`（`schedule-form-state.ts`） |
| C03 | 日历视图 | month / agenda / 未显式选择 | `params.view ?? (isNarrow ? "agenda" : "month")`（`calendar-view.tsx`） |
| C04 | 日历 URL 状态 | 月份 / 选中日 / 成员集合 / 视图 | 解析与写入的跨字段约束（`src/lib/calendar.ts`） |
| C05 | 月历弹层选择 | 同一时刻只开一个，键为 `day` | 单个 URL 字段被 42 个弹层共用（`month-grid.tsx`） |
| C06 | 事件生命周期的三个时钟 | 同上 D01 | `calendar-view`、`day-timeline`、`share-card` 各自维护 `now` |
| C07 | 分享卡片导出 | idle / generating / ready / error / status / busy | 5 个独立字段（`share-button.tsx`） |
| C08 | 空结果与筛选后空 | 三种空状态无区分 | 文案分别写死，没有 `isFiltered` 信号 |
| C09 | 防抖搜索镜像 | 同步 / 输入中 / 已提交 | `query` + `committedQuery` ref 比较（`streams-toolbar.tsx`） |
| C10 | 筛选与排序的空值语义 | 可比 / 排除 / 被筛掉 | `sortValue` 对会员限定返回 `null`（`stream-filters.ts`） |
| C11 | 分页 | 初始 / 展开 / 旧 key | `page.key === filterKey` 派生重置（`streams-view.tsx`） |
| C12 | 表格排序提示 | 不可排 / 未排 / 升序 / 降序 | 与 `sort.key` 字符串比较（`primitives/data-table.tsx`） |
| C13 | 逐字稿加载 | idle / loading / ready / empty / error | 状态联合 + `state.key !== key` 的派生 loading（`hooks/use-transcript.ts`） |
| C14 | 逐字稿分组 | 分组 / 平铺 × 展开集合或默认 | `expanded ?? defaultExpanded` 三态（`transcripts-view.tsx`） |
| C15 | 命令面板 | 查询 × 高亮下标（可为 -1） | `query` 与 `activeIndex` 未校验下界（`command-palette.tsx`） |
| C16 | 成员与分区高亮 | 成员页 / 组页；侧栏把 `stream` 映射为 `streams`，标签栏不映射 | 各组件独立从 pathname 推导（`app-sidebar.tsx`、`mobile-tab-bar.tsx`） |
| C17 | 主题 | 选择（light / dark / system）→ 解析值 → DOM 类 | 三个写入方，侧栏开关会丢弃 `system`（`Layout.astro`、`ThemeProvider.tsx`、`shell-theme.ts`） |
| C18 | 水合闩锁 | false → true，单向 | 伪外部 store（`hooks/use-hydrated.ts`） |
| C19 | 响应式分支 | SSR 默认 false → 客户端匹配 | `useMediaQuery` 的 `md: 800` 与 Tailwind 的 768 不一致 |
| C20 | 路由兼容层 | React `search` / `location.search` / SSR prop 三份 | 无 `popstate`，`pathname` 不更新（`shared/router-compat.tsx`） |
| C21 | 参数序列化 | 合法 → 原值 / 非法 → 默认 | table / gallery / compare / 单场子视图各自实现 |
| C22 | 搜索触发词解析 | 无触发 / 触发 / 正文 / 后缀 | 三段早返回 + 正则字符类（`lib/composer-query.ts`，当前无引用） |
| C23 | 上次成员记忆 | 未知 → 已记住 → 已消费（从未消费） | `preferences.ts` 只写不读 |
| C24 | 图表悬停 | idle / hovering / pending / 已排帧 | ref、rAF 句柄与 state 分离（`hooks/use-throttled-hover.ts`） |
| C25 | 虚拟列表 | 估算高度 / 实测高度 × 滚动位置 × 视口 | `heights` 只在挂载时按长度初始化（`components/dev/virtual-list.tsx`） |
| C26 | 单场详情分支 | locked / missing / full | `if` 分支顺序即策略（`components/app/dataset-page.tsx`） |
| C27 | 单场子视图 | 6 个视图，`transcript` 条件存在；前后场导航 | URL 的 `view` 未与可用视图集合校验（`stream-detail-view.tsx`） |

### 3.3 数据管线（P）

| 编号 | 状态机 | 状态 | 编码方式与位置 |
| --- | --- | --- | --- |
| P01 | 单视频抓取 | 未来场 / 会员限定 / 已抓 / 哨兵不可用 / 宽限期重试 | 会话目录文件 + 两个哨兵文件（`scripts/fetch-streams.ts`） |
| P02 | 回放游标 | done / paused / interrupted / live / no-replay / failed | `work/replay-state.json` 的 `continuation` 与 `stopReason`（`scripts/lib/live-chat-collect.ts`） |
| P03 | 实时弹幕处置 | ended / unplayable / chat_disabled / pending | `classifyWatchStatus` + 上次状态回退（`scripts/fetch-live-chat.ts`） |
| P04 | ingest 判定 | new / existing / forced / skipped / failed | 原始文件哈希与 `streams.content_hash` 比较（`scripts/ingest-db.ts`） |
| P05 | 每日候选计划 | known / deferred(原因) / new / force | 每次运行从数据库与频道列表重算（`scripts/lib/update-plan.ts`） |
| P06 | 发布阶段与状态文件 | absent → recorded → unchanged / changed；按桶与前缀整体失效 | `.publish-state.json` 摘要 + 远端大小（`scripts/lib/publish-state.ts`） |
| P07 | 逐字稿发布 | valid / unchanged / uploaded / failed；数据库同步门控 | 摘要 + mtime 三方合并（`scripts/publish-transcripts.ts`） |
| P08 | Cookie 与登录态 | header / file / env / cache / none；已登录 / 匿名 | 文件形状而非有效性（`scripts/lib/yt-cookies.ts`） |
| P09 | schema 迁移 | v1 / v2 / 混合；top-lists / partial / full | 数据包标题后缀 + 可选字段 |
| P10 | 校验门禁 | validate / verify-data / verify-db，三套真源 | 各自独立脚本，不读取发布或 ingest 记录 |
| P11 | 主播发言补录 | ok / skipped / unavailable / noOwner / failed，外加全局 abort | 对数据包内容的谓词判断（`scripts/backfill-owner-chats.ts`） |
| P12 | 日程同步 | upcoming → live → ended（ended 等于不再触碰） | 只写 `last_live_at`（`scripts/lib/schedule-sync.ts`） |
| P13 | 缓存失效 | fresh / stale / 软失效 / disabled / 新版本冷缓存 | 本次运行累积的 tag 集合，四个调用方各自解释结果 |

### 3.4 请求、API 与中间件（M）

| 编号 | 状态机 | 状态 | 编码方式与位置 |
| --- | --- | --- | --- |
| M01 | 管理端鉴权 | 未配置 503 / 无凭据 401 / cookie 有效 / Basic 有效并签发 cookie / 来源不符 403 | 四个布尔的笛卡尔积（`src/middleware.ts`） |
| M02 | 会话 cookie | absent / malformed / expired / bad-signature / valid | `v1.<exp>.<sig>` 字符串格式（`src/lib/admin-auth.ts`） |
| M03 | 来源校验 | 非写操作 / 无 Origin 放行 / 同源 / 异源 403 | 「没有 Origin」读作「不是不匹配」（`middleware.ts`） |
| M04 | 路径分类 | admin / api / internal / dev / public | 字符串前缀；`/api/admin`（无斜杠）不在守卫内 |
| M05 | 会员限定门禁 | 5 种不同的「未授权」表示 | 各处理器写死自己的状态码与文案 |
| M06 | `?key=` 缓存禁用 | 带 key 一律不可缓存，不论 key 是否正确 | `src/lib/member-access.ts` |
| M07 | 日程 CRUD | 400 / 404 / 409 / 200 / 201，另有改键合并 | `src/pages/api/admin/schedule.ts` |
| M08 | `/api/packs` | 400 / 受限 404 / 缺失 404 / 200 / 503 | 门禁读取的是另一行 |
| M09 | `/api/transcripts` | 400 / 受限 404 / 查询失败后继续 / 503 / 404 / 200 | `summary === null` 会跳过门禁 |
| M10 | `/api/densities` | 400 / 空 200 / 受限即缺键 / 200 / 503 | 「受限」等于 JSON 中缺少属性 |
| M11 | 内部 purge | 503 / 401 / 400 / 200 且 `invalidated:false` / 500 / 200 | 「缓存关闭」被报成成功 |
| M12 | R2 对象可用性 | 命中 / 未命中 / 无绑定 / 生产拒绝 / 抛错 | 统一折叠为 `string \| null` |
| M13 | `.md` 视图 | 缺失 404 / 预告 200 / 正文 200 / 500；GET 与 HEAD 不同 | HEAD 跳过会员门禁 |
| M14 | 页面渲染结果 | failed 500 / 无数据 404 / 有数据 200 × keyed | 每个 `.astro` 手写；组页先写缓存再查询 |
| M15 | 重定向 | 有最新场 302 / 无场 302 / 数据库错误 302 | 错误与空数据不可区分（`stream/index.astro`） |
| M16 | 缓存 | fresh / SWR / 软失效 / 硬清除（未实现）/ disabled / 冷缓存 | tag 词表在配置、页面与脚本三方漂移 |
| M17 | sitemap 与 llms | 收录 / 排除 / 数据库错误未处理 | 各自过滤，无错误态 |
| M18 | 本地与生产模式 | 本地主机名 / 生产 | 一个布尔同时表示环境、安全边界与构建开关（`lib/local-url.ts`） |
| M19 | 路由与分区推导 | 已知分区 / 未知归为 home | 字符串 switch 的默认分支（`lib/routes.ts`） |
| M20 | 单场 `.md` Agent 视图 | 与 M13 同源，额外受 `full` / `transcript` 参数影响 | 缓存变体不写进 tag |
| M21 | 对比 ids 解析 | 合法 / 去重 / 截断 | 同一 URL 在 API 允许 8 个、页面允许 4 个 |
| M22 | 页面重定向与 404 组合 | 302 / 404 / 500 | 组页与成员页各自实现，`calendar.astro` 会把 500 覆盖成 404 |

## 四、问题清单

> 编号与 backlog「审查承接区」一致。位置写到文件与函数；行号会随重构漂移，以符号为准。

### 🔴 Z — 安全与授权

| # | 问题 | 位置 | 建议修法 |
| --- | --- | --- | --- |
| Z1 | 会员限定门禁在摘要查询失败时被跳过，逐字稿或数据包可能原样返回 | `src/pages/api/transcripts/[datasetId]/[videoId].ts` 的 `.catch(() => null)` 与随后的 `if (summary && ...)`；`src/pages/api/packs/[datasetId]/[videoId].ts` 同型 | 门禁改读 payload 自带的 `availability`；摘要查询失败返回 503，不进入返回正文的分支 |
| Z2 | `?key=` 只要出现就禁用缓存，错误 key 也可触发；7 个 URL 可被无凭据放大为完整 SSR | `src/lib/member-access.ts` 的 `keyed` 判定与各路由的 `cache.set(false)` | 仅当资源确为会员限定且 key 校验通过时才 `no-store`；错误 key 返回 404 或 401；优先改为签名 cookie |
| Z3 | 未配置 `ADMIN_SESSION_SECRET` 时用 `ADMIN_PASSWORD` 作为会话 HMAC 密钥，泄露 cookie 后可离线爆破密码 | `src/middleware.ts` 的 `ADMIN_SESSION_SECRET \|\| ADMIN_PASSWORD` | 会话密钥必填，缺失返回 503；密码只用于 Basic 校验 |
| Z4 | 路径守卫用前缀字符串判断，`/api/admin`（无尾斜杠）与未来 `/api/internal` 之外的写法可能落在守卫外 | `src/middleware.ts` 的 `isAdminPath` | 改为显式路由清单或精确匹配，并统一尾斜杠规范化 |
| Z5 | `HEAD` 的 `.md` 请求不检查会员限定，且返回可缓存的 200 | `src/pages/[datasetId]/stream/[videoId].md.ts` 的 `HEAD` | HEAD 复用 GET 的可见性判定与缓存头 |
| Z6 | 写请求没有 `Origin` 时直接放行，CSRF 只剩浏览器行为约束 | `src/middleware.ts` 的写方法分支 | 同时校验 `Sec-Fetch-Site`；无 Origin 时只接受 Bearer 凭据 |
| Z7 | 会员 key 用 `===` 明文比较；未配置 key 时静默锁定全部会限内容；key 被写进页面链接 | `src/lib/visibility.ts`、`src/pages/[datasetId]/stream/[videoId].astro` | 常量时间比较；未配置时显式 503；不要把 key 输出到 HTML |

### 🟠 R — 数据与资源

| # | 问题 | 位置 | 建议修法 |
| --- | --- | --- | --- |
| R1 | 缓存关闭时 purge 返回 `success:true`；`datasets` / `streams` tag 只有 `--all` 才清 | `src/pages/api/internal/cache/purge.ts`、`scripts/lib/purge.ts`、`astro.config.mjs` 的 routeRules | 区分 `skipped` 与 `success`；tag 词表收敛为单一常量模块，配置与脚本共用 |
| R2 | 组页在查询前写缓存，500 会被缓存；成员日历页把 500 覆盖成 404 | `src/pages/{index,gallery,about,calendar,compare}.astro`、`src/pages/[datasetId]/calendar.astro` | 查询成功后再 `cache.set`；错误分支立即返回 |
| R3 | `null`（未抓到）、`0`（真零）、被屏蔽值三种含义共用，消费方各自解码 | `src/db/queries/shared.ts` 的 `maskMemberOnlyMetrics`、`src/lib/group-home.ts`、`src/lib/compare.ts`、`src/db/queries/dataset-totals.ts` | 引入带来源的指标值类型，或至少补 `captured` 与 `masked` 标记 |
| R4 | 「受限」有 5 种表示（200 预告、404、JSON 缺键、sitemap 省略、指标清零），没有 403 | M05 所列各处 | 抽出 `LockedResource` 结果类型；API 统一 403 或统一 404，并复用同一 helper |
| R5 | R2 未命中、无绑定、读取异常都折叠为 `null`，永久缺失被当成可重试的 503 | `src/lib/object-read.ts` | 返回判别联合 `hit / miss / error / unconfigured`，调用方按类型决定状态码 |
| R6 | 日程与真实场次的匹配是每次请求的贪心分配，结果不落库；PATCH 合并会丢弃手工编辑 | `src/lib/calendar.ts` 的 `matchSchedulesToStreams`、`src/pages/api/admin/schedule.ts` 的合并分支 | 持久化 `superseded_by` 或匹配结果；冲突返回 409 并让用户确认；合并时保留手工字段 |
| R7 | 两个哨兵文件形成永久负缓存；`withinGrace` 在 `age < 0` 时写入不可用哨兵 | `scripts/fetch-streams.ts` 的哨兵写入与 `withinGrace` | 哨兵记录时间与原因并定期重试；未来时间不写哨兵 |
| R8 | `live` 有两套窗口：派生状态用 24 小时，`upcomingEvents` 用 12 小时 | `src/lib/calendar.ts` | 抽出单一 `isLive(event, now)`，两个入口共用 |
| R9 | `cancelled` 优先于 `hasStream`，已取消但实际播出的场次永远显示取消；`pending` 没有过期或清理路径 | `src/lib/calendar.ts` 的 `deriveCalendarEventState`、`scripts/lib/schedule-sync.ts` | 明确 `hasStream` 与取消的优先级；为 `pending` 增加基于 `last_seen_at` 的清理策略 |

### 🟡 E — 工程质量

| # | 问题 | 位置 | 建议修法 |
| --- | --- | --- | --- |
| E1 | 同一事件状态由三个独立时钟推导，边界分钟会互相矛盾 | `calendar-view.tsx`、`day-timeline.tsx`、`share-card.tsx` | 父层只保留一个 `now`，向下传递；或抽共享 tick hook |
| E2 | 路由兼容层没有 `popstate` 监听，`pathname` 来自 SSR 且不更新 | `src/components/shared/router-compat.tsx`、`src/lib/router-state.ts` | 订阅 `popstate` 与 Astro 导航事件；pathname 从 `location` 读取 |
| E3 | 参数更新基于渲染时的旧快照，同一 tick 的两次写入会互相覆盖 | `calendar-view.tsx`、`dataset-page.tsx`、`month-grid.tsx` | `setSearchParams` 支持函数式更新，基于最新 URL 合并 |
| E4 | 主题有三个写入方；侧栏开关会把 `system` 改成具体值且没有提示 | `Layout.astro`、`ThemeProvider.tsx`、`shell-theme.ts`、`app-sidebar.tsx` | 单一写入入口；侧栏切换保留 `system`，或明确提示已退出跟随系统 |
| E5 | `useTranscript` 重试一次后，`force` 永久为真，共享缓存对该实例失效 | `src/hooks/use-transcript.ts` | `force` 只作用于单次请求 |
| E6 | 用「派生重置」代替生命周期，保证至少一帧旧状态 | `streams-view.tsx` 的 `page.key`、`use-transcript.ts` 的 `state.key`、`transcripts-view.tsx` 的 `expanded ?? default` | 用 `key` 重挂载或统一 reducer 消除中间帧 |
| E7 | 每日计划的 deferral 在 7 / 14 天后静默停止重试，没有放弃记录 | `scripts/lib/update-plan.ts` | 写入终态记录并输出到运行摘要 |
| E8 | `noOwner` 结果不写标记，下一次运行会重新下载同一场回放 | `scripts/backfill-owner-chats.ts` | 写入「已确认无主播发言」标记 |
| E9 | ingest 抛错时报告停留在 `running`，不会被关闭 | `scripts/ingest-db.ts` 的报告更新位置 | `finally` 中关闭报告；启动时清理陈旧 running 记录 |
| E10 | 空 `source_schema` 在汇总层按 v1、在单场页按 v2，口径相反 | `src/db/queries/dataset-totals.ts`、`src/db/queries/packs.ts` | 抽出单一 `isV2(schema)` 并补 null 测试 |

### 🎨 U — UI/UX

| # | 问题 | 位置 | 建议修法 |
| --- | --- | --- | --- |
| U1 | 空结果与「筛选后为空」文案不同但状态不分，用户找不到真正的恢复动作 | `streams-view.tsx`、`transcripts-view.tsx`、`agenda-list.tsx`、`month-grid.tsx` | 传入 `isFiltered` 与清除筛选动作，空状态说清原因 |
| U2 | `pending` 与 `cancelled` 都划线，语义完全不同 | `calendar-event-row.tsx` | 分开视觉与文案 |
| U3 | `?view=transcript` 在没有逐字稿时仍选中但无高亮页签；锁定页忽略 `view` | `stream-detail-view.tsx`、`dataset-page.tsx` | 用可用视图集合校验 `view`；锁定页清理子视图参数 |
| U4 | 侧栏与移动标签栏对「当前分区」判断不一致 | `app-sidebar.tsx`、`mobile-tab-bar.tsx` | 抽出单一 `activeSection(pathname)` |
| U5 | 分享卡片生成失败时显示「暂时没有可分享的日程」 | `share-button.tsx` | 错误与空数据分分支 |
| U6 | `?members=ghost` 让页面变空，但恢复入口在另一块区域 | `calendar-view.tsx` | 过滤未知成员，或空状态直接提供清除动作 |

## 五、根因分析（blameless）

1. **状态被当作读时计算，而不是写入时事实。** 没有状态列，导致缓存页面、管理员视图和公开视图各自重算，且没有审计记录。系统允许这种写法，因为 schema 只存原始字段，读层没有统一的状态模块。
2. **规则没有单一归属。** 会员限定、`live` 判定、v1/v2 默认、缓存 tag 都缺少一个「所有调用方必须导入」的模块，复制成本低于抽取成本。
3. **副作用返回值的语义不完整。** purge、对象读取、缓存写入都只有成功 / 失败两态，无法表达「跳过」「未配置」「软失效」「永久缺失」，调用方只能猜。
4. **验收标准偏向页面可打开，而非状态组合。** 现有测试覆盖纯函数与解析器，鉴权组合、缓存失败、合并冲突、管线恢复缺少可失败的断言。

## 六、行动优先级

| 优先级 | 内容 | 理由 |
| --- | --- | --- |
| P0 | Z1 Z2 Z3 Z4 Z5、R1 | 授权可绕过、缓存假成功、凭据可离线爆破，属于安全与正确性 |
| P1 | Z6 Z7、R2–R9、E1–E5 | 用户可见的数据错误、缓存污染与交互竞争 |
| P2 | E6–E10、U1–U6、D07–D12 的显式化 | 一致性债务与体验问题，可与功能迭代合并 |
| P3 | C15、C22、C23、C25 等未引用或开发态组件 | 当前影响范围小，随触达文件时清理 |

实施顺序、验收标准与文件范围见 [state-machine-remediation.md](../planning/state-machine-remediation.md)。

## 七、实施状态（2026-11-08）

首轮实施完成。`Z` 全部关闭；`R` 大部分关闭；`E` 与 `U` 的主要行为问题已修，剩余为需要更大改动的条目。

| 状态 | 条目 |
| --- | --- |
| ✅ 已修 | Z1–Z7、R1–R9、E1–E10、U2、U4、U5、U6 |
| 🚧 拆出后续 | U1（逐字稿与议程空状态）、U3（锁定页清理子视图参数） |

第三轮补充：

- R3：`StreamSummary` / `GroupStreamSummary` 增加 `masked` 标记，屏蔽行不再靠 `availability` 反推；列表、相册、首页与 CSV 统一使用。
- R6：ingest 在每个成员结束后调用 `backfillSupersededSchedules`，复用 `matchSchedulesToStreams` 回填无 `videoId` 的模糊匹配。
- U1 / U3 的具体页面文案与参数清理拆为 backlog B29 / B30。

验证：

- `bun run test`：422 tests 通过。
- `bun run lint`：0 errors（27 个既有 warning，与本次改动无关）。
- `bunx tsc --noEmit`：通过。
- `bun run build`：通过（本地 `LOCAL=1`）。
- `bun run typecheck` 仍因缺 `@astrojs/check` 与 emnapi 崩溃未跑通，与本次改动无关。

## 八、验证与限制

- 本次为静态审查。除文中标注的代码路径外，未做运行时复现；Z1、Z2、R1 在实施前应先补可失败的测试。
- 行号未写入正文，避免重构后失真；位置以文件与函数名为准。
- 清单按层登记 74 条，跨层重复的条目已在正文标注（如 D01 与 C06、D03 与 M08 的时间推导）。

## 参考

- [architecture.md](../planning/architecture.md)：分层、数据流、缓存与 ADR。
- [data-model.md](../data/data-model.md)：字段口径与可空值语义。
- [postmortem/README.md](../postmortem/README.md)：基线雷区与既有事故。
- [information-density.md](../ui-design/information-density.md)：空状态与信息的取舍。
- [backlog.md](../planning/backlog.md)：审查承接区与排期。

