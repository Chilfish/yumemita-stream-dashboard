---
编号: 006
主题: 公开 R2 域名直接暴露会限逐字稿与原始 pack
日期: 2026-11-15
严重级别: SEV-1
分类: 架构
状态: Active
根因归类: 设计建模
---

# 006 — 公开 R2 域名直接暴露会限逐字稿与原始 pack

## 摘要

`ymmt-s3.chilfish.top` 是 `yumemita-data` 桶的公开自定义域，而会限场次的逐字稿正文（`<datasetId>/transcripts/<videoId>.json`）与原始 pack（`archive/<datasetId>/<videoId>.datapack.json`）也在同一个桶里。任何知道 videoId 的人都能匿名下载这两类对象，绕过页面、`/api/*`、访问参数与响应头缓存策略。

系统条件：一个桶同时承担「公开媒体」与「需要按场次授权的内容」，公开域名按桶暴露全部 key。此前的自查只验证了「页面通过同源 API 读取正文」，没有验证「对象本身是否匿名可达」。

## 影响

- 会员限定场的逐字稿全文、弹幕、SC、评论可被任意第三方获取，访问参数形同虚设。
- 影响范围是所有已发布到该桶的会限场次，数量未逐一核对。
- 未发现写入或删除能力；泄露面是读。

## 时间线

| 日期 / commit | 事件 |
| --- | --- |
| 2026-11-15 | 安全自查对公开域名做匿名抽查，`transcripts/` 与 `archive/` 均返回 200 |
| 2026-11-15 | 确认同场在页面与 API 上仍按会限处理；问题定位到桶级公开域，不是访问逻辑 |

## 根因分析（blameless）

1. 存储布局按「对象类型」分 key，而不是按「公开级别」分桶。`thumbs/`、`emojis/` 需要公开，`transcripts/`、`archive/` 需要授权，但四者共享同一个公开域。
2. 验收只看应用层：页面走 `memberOnlyCachePolicy`、API 走 `memberOnlyAccess`，就认为正文没有暴露。缺少「从外网匿名直取对象」的检查。
3. 发布脚本把 archive 当作备份一并写进主桶，没有「私有对象写私有桶」的约束。
4. 基线雷区里已有「公开桶范围」条目，但对策写成了「正文走同源 API + binding」——描述的是读取路径，不是可达性，等于把错误假设写成了自查项。

## 触发条件

桶开启了公开自定义域，且私有对象的 key 可从公开数据（videoId 列表）推导。

## 检测

随会员限定 403 问题的排查做攻防演练时，对 `ymmt-s3` 直接发匿名请求发现。此前的发布验证只覆盖 `thumbs/`、`emojis/` 与 API 状态码，没有覆盖私有 key。

## 处置

- 代码层：没有可单独修复的点；需要桶 / 路由配置。
- 待执行：Cloudflare WAF 规则拦截公开域上的 `*/transcripts/*` 与 `/archive/*`；随后把这两类对象迁到私有桶。
- 与本次同时修复的相邻问题：JSON-LD 注入转义、页面 CSP、访问参数透传（见 [security-review-2026-11-15.md](../research/security-review-2026-11-15.md)）。

## 做得对的地方

- 页面与 API 的授权判定本身是正确的，问题没有扩散到数据库查询层。
- 会限 `.md` 只输出标题与封面，说明公开范围在应用层被认真区分过。

## 行动项

### 缓解（针对已发生的具体缺口）

- [ ] P0 维护者：给 `ymmt-s3.chilfish.top` 加 WAF 规则，block `*/transcripts/*` 与 `/archive/*`
- [ ] P0 维护者：把 `archive/` 与 `*/transcripts/` 迁移到私有桶，Worker 增加私有 binding
- [ ] P0 维护者：轮换 `MEMBER_ONLY_KEY`（即便当前参数未直接泄漏，公开对象已使授权失效）
- [ ] P1 维护者：发布脚本增加约束，私有对象不得写入公开桶
- [ ] P1 维护者：补匿名可达性检查到发布验证（`validate data --remote` 或冒烟脚本）

### 预防（针对整类问题）

- [ ] 基线雷区改写成可达性自查：私有 key 必须匿名请求验证返回 404 / 403
- [ ] 新增桶级配置变更时，必须同时验证公开域对私有前缀的响应

## 教训

按公开级别分桶，而不是按对象类型分目录；「应用层做了鉴权」不等于「对象不可匿名访问」。写进 [README.md](./README.md) 的「数据与对象存储」自查。

## Changed Files

```text
docs/research/security-review-2026-11-15.md
docs/postmortem/006-public-r2-member-only-leak.md
docs/postmortem/README.md
docs/engineering/deployment.md
docs/planning/backlog.md
```

## 关联报告

- [security-review-2026-11-15.md](../research/security-review-2026-11-15.md)
- 基线雷区「数据与对象存储」与「Astro + PostgreSQL + Workers」
