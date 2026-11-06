---
编号: 003
主题: `~/yt-cookies.txt` 长期复用后失效，yt-dlp 命中 bot 检查
日期: 2026-11-07
严重级别: SEV-3
分类: 缺陷
状态: Mitigated
根因归类: 设计建模
---

# 003 — `~/yt-cookies.txt` 长期复用后失效，yt-dlp 命中 bot 检查

## 摘要

抓取脚本把浏览器导出的 cookie 缓存到 `~/yt-cookies.txt`，之后永久复用。浏览器会轮换 `__Secure-*PSIDTS`，旧 jar 里的会话随之失效；yt-dlp 带着它请求 YouTube 会稳定返回 "Sign in to confirm you're not a bot"，而同一时刻 `--cookies-from-browser firefox` 却能正常读取。缓存从未重新导出，也没有任何检查能发现「文件存在但会话已过期」。

## 影响

- 本地 `fetch-streams` / `fetch-danmaku` / `fetch-live-chat` / `daily-update` / `backfill-owner-chats` 全部无法读取元信息，整轮抓取失败。
- CI 走手动导出的 `YT_COOKIES` Secret，不受本地缓存影响；Secret 过期时由 `Check YouTube access` 探针提前失败。
- 数据未损坏：失败发生在抓取入口，没有写入 pack 或数据库。

## 时间线

| 日期 / commit | 事件 |
| --- | --- |
| 2026-11-06 | 抓取时发现 `--cookies-from-browser firefox` 可用，脚本缓存的 jar 报 bot 检查 |
| 2026-11-07 | 对比两份 jar：缓存 47 条，缺少 `.youtube.com` 的 `SID` / `HSID` / `SAPISID` / `APISID` / `SSID` / `__Secure-1PSID` / `LOGIN_INFO`；新导出 57 条，主登录 cookie 齐全 |
| 2026-11-07 | 改为每次运行重新导出，导出失败才退回旧缓存；`--no-cookies` 不再回退浏览器 |

## 根因分析（blameless）

1. 缓存策略只有「缺失时导出」，没有失效条件；`maxAgeMs` 默认 0 表示永不过期。
2. `inspectCookieJar` 只检查存在 `SID` / `__Secure-*PSID` 中任意一个，残缺的 jar 也能通过校验。
3. 浏览器与文件 jar 是两套会话：浏览器继续使用时会轮换 PSIDTS，文件不会自动跟进。
4. 失败信息指向「cookie 无效」，但没有提示「先别用缓存」，排查容易绕到代理 / PO token 上。

## 触发条件

本机使用 Firefox 登录 YouTube，并把 `~/yt-cookies.txt` 跨多次抓取复用；浏览器期间产生过新的会话请求，YouTube 轮换了 `.youtube.com` 的 PSIDTS。CI 无浏览器 profile，只读 Secret 文件，因此不会触发本地这条路径。

## 检测

用户对照 `--cookies-from-browser` 与 `--cookies` 的输出差异时发现。检测盲区：缓存校验只看「有没有登录 cookie」，不看「这份会话还能不能用」；没有在抓取前做一次轻量探针。

## 处置

- `ensureCookieJar` 默认每次运行重新导出，整轮抓取复用同一个 jar；导出失败才退回旧缓存。
- 移除各脚本的 `--refresh-cookies`：默认行为已经是刷新。
- `ytdlpCookieArgs` 对 `source === 'none'` 返回空参数，`--no-cookies` 真正匿名。
- 文档与开发日志同步：`scripts/README.md`、`docs/data/data-model.md`、[开发日志 2026-11-07](../development-log/2026-11-07.md)。

## 做得对的地方

- 缓存文件与导出逻辑集中在 `scripts/lib/yt-cookies.ts`，一处修改覆盖所有抓取脚本。
- 导出失败会回退旧缓存，断网或浏览器 profile 读不到时不会让整轮任务失去登录态。
- 失败信息保留在 stderr 里（没有 `--no-warnings`），bot 检查能被直接看到。

## 行动项

### 缓解（针对已发生的具体缺口）

- [x] 每次运行重新导出 cookie（维护者）
- [x] `--no-cookies` 不再回退浏览器 cookie（维护者）
- [x] 单元测试覆盖 `--no-cookies` 的 yt-dlp 参数（维护者）

### 预防（针对整类问题）

- [ ] 为「外部凭据缓存」增加可观测性：导出条数、登录态、youtube.com 条数写入日志，异常时告警（维护者）
- [ ] CI Secret 过期仍依赖探针；后续可考虑在探针失败时提示重新 `export-yt-cookies --push`（维护者）

## 教训

1. 外部会话类缓存必须有失效策略；「文件存在」不等于「凭据可用」。
2. 同一个请求用两条凭据路径（浏览器直读 vs 文件 jar）对照，是最快的定位方法。

## Changed Files

```text
scripts/lib/yt-cookies.ts
scripts/lib/yt-cookies.test.ts
scripts/fetch-streams.ts
scripts/fetch-danmaku.ts
scripts/fetch-live-chat.ts
scripts/daily-update.ts
scripts/backfill-owner-chats.ts
scripts/README.md
docs/data/data-model.md
```

## 关联报告

- [002](./002-dataset-packs-per-render.md)：同属「工具结果看起来正常，口径已经偏离」的检测盲区
