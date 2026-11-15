# 2026-11-15 安全自查（攻防演练）

> 目标：验证 `/admin`、会员限定访问参数，以及页面上的注入面是否能被第三方绕过。
> 方法：读代码 + 对本地 preview 与线上做匿名 / 带 Cookie 的请求对照。没有做压力型爆破。

## 结论

| 编号 | 问题 | 级别 | 状态 |
| --- | --- | --- | --- |
| F1 | 公开 R2 域名可直接下载会限逐字稿与原始 pack | 严重 | 未修复（需桶 / WAF 配置） |
| F2 | `/admin` 与访问参数没有速率限制 | 中 | 未修复（Cloudflare Rate Limiting） |
| F3 | 访问参数是低熵共享口令，无轮换机制 | 中 | 建议轮换 |
| F4 | JSON-LD 直接用 `JSON.stringify` 注入 `<script>` | 中 | 已修复 |
| F5 | 页面没有 CSP，注入的外部脚本不受限制 | 中 | 已修复 |

## F1：公开桶暴露会限内容（严重）

`ymmt-s3.chilfish.top` 是 `yumemita-data` 桶的公开自定义域。桶里的 key 布局把正文与原始 pack 和封面放在一起：

```text
<datasetId>/transcripts/<videoId>.json        # 逐字稿正文
archive/<datasetId>/<videoId>.datapack.json   # 原始 pack：弹幕 / SC / 评论
<datasetId>/thumbs/<videoId>.jpg              # 封面（本来就该公开）
emojis/...                                    # 表情（本来就该公开）
```

匿名请求这两个路径都返回 200：

```text
GET https://ymmt-s3.chilfish.top/ritsu/transcripts/jAAu3rz0TTI.json        → 200
GET https://ymmt-s3.chilfish.top/archive/ritsu/jAAu3rz0TTI.datapack.json   → 200
GET https://ymmt-s3.chilfish.top/ritsu/transcripts/nope.json               → 404
```

该场是会员限定（`availability = subscriber_only`）。逐字稿正文、弹幕、SC 与评论因此完全绕过了页面、`/api/*` 与访问参数，只要知道 videoId（站点公开列出）就能下载。CORS 不构成保护：非浏览器客户端不看 CORS。

**修复方向**

1. 立即：在 Cloudflare 给 `ymmt-s3.chilfish.top` 加 WAF 自定义规则，`uri.path contains "/transcripts/"` 或 `starts_with(uri.path, "/archive/")` 时 block。规则只作用于该主机，不影响同源 API。
2. 正解：把 `archive/` 与 `*/transcripts/` 写入独立的私有桶，Worker 增加一个 `R2_PRIVATE` binding；公开桶只留 `thumbs/` 与 `emojis/`。需要一次对象迁移与发布脚本改造。
3. 迁移完成前，公开桶不应再写入新的会限对象。

## F2：没有速率限制（中）

`/admin/*`、`/api/admin/*` 与会限 API 都没有请求频率约束：

- `ADMIN_PASSWORD` 走 HTTP Basic，可无限次尝试。密码长度足够时风险有限，但没有任何成本递增。
- 会限 `?key=` 同样是无限次尝试。当前参数是低熵口令，可被字典穷举。

**建议**：Cloudflare Rate Limiting 规则覆盖 `/admin*`、`/api/admin*`；对 `403` 比例高的 `/api/transcripts/*`、`/api/packs/*` 单独限速。Worker 内部再做计数需要 KV / Durable Object，成本高且隔离级别不统一，不作为首选。

## F3：访问参数熵不足（中）

`MEMBER_ONLY_KEY` 是共享口令，出现在页面 URL 与 API query 里，不会进入 HTML（已处理），但仍会进入浏览器历史、同源日志与用户分享的链接。键值同时用于所有会限场次，无法按人撤销。

**建议**：

- 使用至少 32 位随机字符，不要复用域名、昵称或常见词。
- 怀疑泄漏时直接轮换；轮换不需要改代码。
- 不要把真实值写进文档、日志、issue 或 commit message。

## F4：JSON-LD 注入（已修复）

`SEO.astro` 用 `set:html={JSON.stringify(item)}` 输出结构化数据。`JSON.stringify` 不转义 `<`，场次标题里出现 `</script>` 就能提前闭合标签并注入脚本。

修复：`serializeJsonLd()` 转义 `<`、`>`、`&`、U+2028、U+2029，输出仍可被 `JSON.parse` 还原。测试覆盖 `</script><script>alert(1)</script>` 与行分隔符。

## F5：缺少 CSP（已修复）

页面会加载内联主题脚本与 `<ClientRouter />`，Astro 内置 CSP 目前不支持 View Transitions，因此没有启用框架方案，改为 middleware 统一下发：

```text
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self';
form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: <PUBLIC_R2_BASE>; font-src 'self' data:;
connect-src 'self' <PUBLIC_R2_BASE>; manifest-src 'self'; media-src 'self';
worker-src 'self' blob:
```

`script-src` 保留 `'unsafe-inline'` 是现状约束（见 `src/lib/security-headers.ts` 注释）；外部脚本被禁止，能挡住注入 `<script src="//evil">`。

验证：`astro preview` 下 `/`、`/miyako/stream/<id>?view=transcript`、`/miyako/gallery` 均无 CSP 控制台报错，`ClientRouter` 站内跳转正常。

## 已验证没有问题的部分

| 检查 | 结果 |
| --- | --- |
| `/admin/schedule`、`/api/admin/schedule` 未登录 | 401，带 `WWW-Authenticate` |
| `//admin/schedule`、`/./admin/schedule` | 401（路径规范化后仍进守卫） |
| `/Admin/schedule`、`/admin%2Fschedule` | 404，不落到 admin 路由 |
| 伪造 / 过期 `ymmt_admin` Cookie | 401（HMAC 校验，签名不符） |
| 跨站 POST（带 Cookie、无 Origin） | 403（`Sec-Fetch-Site` / Origin 校验） |
| 修改类请求跨源 Origin | 403 |
| 会限 API 无参数 / 错误参数 | 403，响应 `no-store` |
| 会限 API 带正确参数 | 200，响应 `private, no-store` |
| 会限页面 / `.md` 无参数 | 只给标题与封面，不返回正文 |
| 逐字稿 Markdown 的 `javascript:` 链接 | react-markdown 默认 `urlTransform` 已过滤 |
| `dangerouslySetInnerHTML` / `innerHTML` | 全仓库无使用 |
| 认证比较 | 常数时间比较；长度不同直接返回 |

## 未验证 / 未覆盖

- 没有做真实爆破或高并发压测，速率限制只能从配置层面确认。
- 线上 `/api/transcripts/<id>` 抽查返回 503（R2 binding 或数据侧问题），因此**无法确认线上 API 的 200 / 403 分支**；F1 的公开桶下载路径不受影响，已实测 200。
- CSP 未覆盖 `ast:` 生产构建的最终域名（本地 `astro preview` 的媒体地址是 SILO），部署后需复查一次响应头与页面控制台。
