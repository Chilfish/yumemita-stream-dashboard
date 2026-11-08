# 隐式状态机显式化（阶段方案）

> 状态：🚧 首轮实施完成（2026-11-08）。阶段 0 / 1 / 3 完成；阶段 2 / 4 / 5 的主要修复已落地，剩余项见文末「实施状态」。
> 来源：[review-2026-11-08-implicit-state-machines.md](../reviews/review-2026-11-08-implicit-state-machines.md)。
> 本文写目标形态与实施顺序；已成立的事实以代码和 [architecture.md](./architecture.md) 为准。

## 1. 问题与目标

审查登记了 74 条隐式状态机。需要解决的不是数量，而是三件事：

1. 授权与可见性在查询失败、请求方法、路径写法变化时退出判定。
2. 缓存与对象存储把「未执行 / 缺失 / 未配置」报成「成功 / 可重试」，导致陈旧与误判。
3. 生命周期由多个组件、多个脚本各自推导，同一行数据在不同入口给出不同状态。

目标形态：

- 每个需要转移的概念有一个判别联合或一个单一判定函数，调用方只消费结果，不重写规则。
- 写入时能落库的状态就落库；不能落库的（如依赖 `now` 的直播状态）只允许一个函数计算，所有入口共用。
- 副作用返回结果类型，能表达 `skipped`、`miss`、`unconfigured`、`stale`，不再用布尔或 `null` 折叠。
- 每个阶段先写可失败的验收断言，再改实现。

## 2. 范围与非目标

范围：

- `src/middleware.ts`、`src/lib/{admin-auth,visibility,member-access,object-read,calendar,schedule}.ts`。
- `src/pages/api/**/*.ts`、`src/pages/[datasetId]/stream/[videoId].md.ts`。
- `src/pages/[datasetId]/*.astro` 与组级页面的缓存与错误分支。
- `src/lib/router-state.ts`、`src/components/shared/router-compat.tsx`、日历与列表岛屿的 URL 写入。
- `scripts/fetch-streams.ts`、`ingest-db.ts`、`daily-update.ts`、`scripts/lib/{update-plan,purge,publish-state}.ts`。
- 必要的数据库迁移（仅在「状态必须落库」的阶段）。

非目标：

- 不重写日历、图表或列表的视觉层。
- 不引入状态管理库；URL 仍是可分享状态的来源。
- 不改变数据口径（JST、金额不分币种换算、会员限定公开范围）。
- 不处理审查中标记为 P3 的未引用组件（`composer-query.ts`、`preferences.ts` 的写入口等），除非触达同一文件。

## 3. 设计原则

| 原则 | 做法 | 反例（当前） |
| --- | --- | --- |
| 状态用判别联合 | `type LoadState = { status: "idle" } \| { status: "loading" } \| ...` | `saving`、`error`、`editingKey` 同时存在 |
| 单一判定函数 | `isLive(event, now)`、`isV2(schema)`、`lockedReason(resource)` | `live` 有 24h 与 12h 两套 |
| 副作用返回 Result | `{ kind: "hit" \| "miss" \| "error" \| "unconfigured" }` | 对象读取统一返回 `null` |
| 规则单一归属 | 会员限定与缓存 tag 从共享模块导入 | `datasets` / `streams` tag 只出现在配置里 |
| 写入先于读取 | 能落库的状态在转移发生时写入 | 日历匹配结果只存在于请求内 `Map` |
| 测试先行 | 每个阶段先补一个会失败的用例 | 鉴权组合与缓存失败没有断言 |

## 4. 实施阶段

### 阶段 0：测试夹具与共享类型（📋）

先建立可以失败的样本，避免「改完看起来好了」。

- 为鉴权组合、`?key=` 缓存策略、对象读取结果、日历状态边界、`isV2(null)` 各补一组单元测试。
- 新增 `src/lib/state/`（名称待定）存放共享判别联合与判定函数，只放纯逻辑，不引入 IO。
- 验收：新增测试在当前实现上至少各失败一次，失败原因与审查条目一致。

### 阶段 1：授权与可见性闭环（P0，📋）

对应 Z1–Z7、R4、R5。

- 会员限定门禁改为读取 payload 自带的 `availability`；摘要查询失败返回 503，不进入返回正文的分支。
- `?key=` 只在资源确为会员限定且 key 校验通过时禁用缓存；错误 key 返回 404 或 401。
- 会话密钥与登录密码分离；`ADMIN_SESSION_SECRET` 缺失返回 503。
- 管理端路径改为显式清单；补尾斜杠规范化。
- `.md` 的 `HEAD` 复用 `GET` 的可见性判定。
- 对象读取返回判别联合；未命中与错误映射到不同状态码。
- 统一「受限」的 API 表示，优先 403；至少保证同一事实只出现一种状态码。

验收：

- AC-Z1：模拟摘要查询抛错，`/api/transcripts` 与 `/api/packs` 返回 503，且不包含正文。
- AC-Z2：错误 `?key=` 不再产生 `private, no-store` 的 200；正确 key 仍可解锁且不缓存。
- AC-Z3：未配置会话密钥时管理端返回 503；配置后 cookie 签发与校验不受密码变更影响。
- AC-Z4：`/api/admin`（无尾斜杠）与 `/api/admin/` 都被守卫覆盖，并有测试固定。
- AC-Z5：`HEAD` 与 `GET` 对同一会员限定 `.md` 的可见性一致。
- AC-R4/R5：受限、缺失、读取错误在 API 响应中可区分。

### 阶段 2：生命周期与数据一致性（P1，📋）

对应 R3、R6–R9、D01–D12。

- `null` / `0` / 被屏蔽三义拆分：至少在查询层返回带 `captured` 与 `masked` 标记的值，或在共享类型中表达。
- 日历事件的 `live` 判定收敛为单一函数；`cancelled` 与 `hasStream` 的优先级写进同一个函数并补测试。
- 日程匹配结果持久化，或至少在合并冲突时返回 409 并保留手工字段。
- `pending` 增加基于 `last_seen_at` 的清理策略。
- v1 / v2 判定收敛为 `isV2(schema)`，空 schema 的行为由测试固定。

验收：

- AC-R3：会员限定场次在组首页、对比页、单场页的 `streamCount` 与聚合口径一致；被屏蔽值不再与「未抓到」共用 `0`。
- AC-R8：同一 `now` 下，`deriveCalendarEventState` 与 `upcomingEvents` 对 `live` 的判断一致。
- AC-R9：已取消但已有 `streams` 行的场次按明确规则显示，不出现「已取消」与「已结束」二义。
- AC-R6：两个手工日程竞争同一场次时，结果确定；合并不会丢失 `note`、`kind`、`expectedMinutes`。

### 阶段 3：缓存与错误态（P1，📋）

对应 R1、R2、M05、M11–M16。

- purge 结果区分 `success`、`skipped`、`failed`；`cache disabled` 不再计入成功。
- tag 词表收敛为 `src/lib/cache-tags.ts`（名称待定），`astro.config.mjs`、页面与脚本共用。
- 组页与成员页改为查询成功后再 `cache.set`；错误分支先返回，不再被后续 404 覆盖。
- 明确 `invalidate` 与 `purge` 的语义；正确性优先的路径使用硬清除。

验收：

- AC-R1：关闭缓存时调用 purge，调用方收到 `skipped` 而不是 `success`；日常 ingest 能清掉 `datasets` / `streams` 相关条目。
- AC-R2：数据库查询抛错时，组页返回 500 且不进入缓存；成员日历页不再把 500 变成 404。
- AC-M11：缓存关闭、token 缺失、tag 为空三种结果在响应与脚本摘要中可区分。

### 阶段 4：客户端状态收敛（P2，📋）

对应 E1–E6、C01–C27 中影响行为的条目。

- 日历只保留一个 `now`，向下传递。
- `setSearchParams` 支持函数式更新，消除同 tick 覆盖。
- 主题只保留一个写入入口；侧栏切换不再静默丢弃 `system`。
- `useTranscript` 的 `force` 只作用于单次请求。
- 编辑器、加载、分页、展开等状态改为判别联合或 reducer，消除「派生重置」造成的一帧旧状态。
- 空状态区分「无数据」与「筛选后为空」，给出对应恢复动作。

验收：

- AC-E1：同一时刻，日历头部、时间线与分享卡片对同一事件的状态一致。
- AC-E3：同一 tick 内连续两次筛选写入后，URL 同时包含两次意图。
- AC-E4：从 `system` 切到具体主题再切回，状态可恢复；不再出现一帧错误图标。
- AC-E5：重试成功后，共享缓存重新生效。
- AC-U1：筛选后为空时，空状态提供清除筛选动作。

### 阶段 5：数据管线幂等与终态（P2，📋）

对应 E7–E10、P01–P13。

- 抓取哨兵记录时间与原因，支持定期重试；未来时间不写不可用哨兵。
- `update-plan` 的 deferral 写入终态记录，运行摘要输出放弃原因。
- `backfill-owner-chats` 写入「已确认无主播发言」标记。
- ingest 报告在 `finally` 中关闭；启动时清理陈旧 `running`。
- `publish-state` 的 adopt 路径写入记录，避免同尺寸变更永久不可见。

验收：

- AC-E7：超过重试窗口的场次在运行摘要中显示「已放弃」及原因，而不是静默消失。
- AC-E8：第二次运行不会重新下载已确认无主播发言的场次。
- AC-E9：人为中断 ingest 后，报告不再停留在 `running`。
- AC-P06：远端同尺寸但内容变化的对象能被检测到，或被明确标注为「按尺寸信任」。

## 5. 验证

每个阶段交付前：

```bash
bun run check
bun run test
bun run build
```

按改动追加：

```bash
bun run db:verify      # 改 ingest / schema
bun run db:query       # 改查询层
bun run validate:data  # 改 pack
bun run db:bench       # 改读路径
bun run test:smoke     # 改路由
```

- 授权与缓存改动必须在 `bun run dev` 或 `bun run preview` 下手工走查受影响 URL，并记录请求方法与状态码。
- 数据模型改动先跑本地迁移与 `db:verify`，再考虑远端；远端写量按 [backlog.md](./backlog.md) 的成本约束评估。
- 未执行的检查标「未验证」。

## 6. 风险与回滚

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 授权收紧导致正常访问被拒 | 会员限定内容或管理端不可用 | 先补测试与手工矩阵；分路由上线；保留 503 与 404 的明确文案 |
| 状态落库需要迁移 | 远端写量与兼容性 | 新列可空、默认回退旧逻辑；先本地 `db:verify`；分批写入 |
| tag 词表统一后漏清旧 tag | 短期陈旧 | 保留一个发布周期的兼容 tag；`purge-cache --all` 兜底 |
| URL 写入改为函数式后行为变化 | 分享链接变化 | 保留现有 `parse` / `write` 往返测试，并补同 tick 用例 |

## 7. 文件范围（实施时更新）

| 阶段 | 主要文件 |
| --- | --- |
| 0 | 各 `*.test.ts`、新增共享类型模块 |
| 1 | `src/middleware.ts`、`src/lib/{admin-auth,visibility,member-access,object-read}.ts`、`src/pages/api/**`、`[videoId].md.ts` |
| 2 | `src/lib/{calendar,schedule}.ts`、`src/db/queries/*`、必要的 `src/db/schema.ts` 迁移与 `scripts/lib/schedule-sync.ts` |
| 3 | `astro.config.mjs`、`src/pages/**/*.astro`、`src/pages/api/internal/cache/purge.ts`、`scripts/lib/purge.ts` |
| 4 | `src/components/**`、`src/hooks/*`、`src/lib/{router-state,router-compat,calendar}.ts` |
| 5 | `scripts/{fetch-streams,ingest-db,daily-update,backfill-owner-chats}.ts`、`scripts/lib/{update-plan,publish-state}.ts` |

## 7.1 实施状态（2026-11-08）

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 0 测试夹具与共享类型 | ✅ | `admin-path`、`secure-compare`、`schema-version`、`object-result` 与对应单测；`cache-tags` 词表 |
| 1 授权与可见性闭环 | ✅ | Z1–Z7、R4/R5 的 API 部分 |
| 2 生命周期与数据一致性 | ✅ | `isLive` 单点、`hasStream` 优先、匹配稳定排序、合并保留字段、`superseded_by` 落库（迁移 `0008`）、`isV2Pack`、读数区分会限 |
| 3 缓存与错误态 | ✅ | purge `skipped` 语义、tag 词表收敛、查询成功后写缓存、500 不再被覆盖 |
| 4 客户端状态收敛 | 🚧 | 单一时钟、函数式 URL 更新、`popstate`、主题单一解析、`force` 单次、逐字稿已解析缓存、空状态与会话视图回退；U4 未统一 |
| 5 管线幂等与终态 | ✅ | `expiredIds`、`noOwner` 标记、ingest 报告关闭、adopt 记录、时钟偏差、哨兵 30 天过期、过期自动日程清理 |

验证命令与结果记录在 [开发日志 2026-11-08](../development-log/2026-11-08.md)。

## 8. 完成标准

- 审查问题清单中的 P0、P1、P2 全部关闭，或明确转为 backlog 条目并写明原因。
- 每个阶段至少有一组在旧实现上会失败的测试。
- 同一规则在仓库中只有一个实现入口；发现第二份时先删再加。
- `docs/README.md`、`docs/planning/README.md`、[backlog.md](./backlog.md) 与本档保持一致。
- 新增的架构取舍补进 [architecture.md](./architecture.md) 的 ADR。
