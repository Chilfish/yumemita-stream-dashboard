# Release Checklist

**项目**：yumemita-stream-dashboard | **最后更新**：2026-11-04

> 当前部署：Astro SSR on Cloudflare Workers + Neon PostgreSQL + R2。
> 目标：每个里程碑在真实环境验证通过，不留已知回归。

## 版本纪律

- 版本号单一来源：`package.json` 的 `version`。
- 只在验证门禁通过后打 tag：`git tag v0.1.0 && git push --tags`。
- `CHANGELOG.md` 的 Unreleased 节在发布前迁移到版本节。

## 验证门禁（发布前必过）

- [ ] `bun run check` 通过（astro check + test + lint）
- [ ] `bun run build` 通过
- [ ] `bun run db:verify` 通过（改 ingest / 数据时）
- [ ] `bun run db:query` 通过（改查询层时）
- [ ] `bun run test:smoke` 通过（先启动 `bun run preview` 或指向线上）
- [ ] 涉及页面的改动已手工走查并记录路径与结果
- [ ] 没有把「构建通过」写成「功能已验证」

## 功能冒烟

在部署后的 URL 执行，勾选并记录日期。

### 页面与路由

- [ ] `/` 组首页可见，近 7 天 / 本月脉冲、最新一场、成员入口正常
- [ ] `/:datasetId` 成员首页可见，指标、最近一场、日历正常
- [ ] `/:datasetId/streams` 搜索、类型筛选、排序、CSV 导出正常；刷新后 URL 状态保持
- [ ] `/:datasetId/stream/<videoId>` 深链刷新正常；`?view=` 分段可分享
- [ ] `/:datasetId/trends` 趋势与月度明细正常
- [ ] `/:datasetId/gallery` 与 `/gallery` 相册按 JST 月份分组，筛选写进 URL
- [ ] `/:datasetId/compare?ids=a,b,c` 最多 4 场，曲线叠加正常
- [ ] `/compare?members=&type=&months=` 全员对比：筛选写进 URL、刷新保持、样本不足有标注
- [ ] `/:datasetId/transcripts` 与有稿单场的逐字稿分段正常；时间码跳转正确
- [ ] 不存在的路径 / dataset / videoId 返回 404
- [ ] 旧 `#/...` 链接能改写成真实路径
- [ ] `/about` 显示说明与免责；`/:datasetId/about` 302 到 `/about`
- [ ] 会员限定场次出现在列表 / 相册 / 场次与日期统计中（封面、标题、时间），但弹幕 / SC / 同接 / 评论显示「—」；成员首页与组首页大图不选会限场次；单场未解锁时复用详情模板展示元数据与公开范围说明。sitemap 与逐字稿索引不收录会限派生内容
- [ ] 会限单场的 `.md` 只输出标题与封面；`/api/packs`、`/api/transcripts` 返回 404

### 主题与响应式

- [ ] 浅色 / 深色 / 跟随系统切换生效并持久化
- [ ] 首屏无主题闪烁
- [ ] 1440 / 1024 / 768 / 390 / 320px 无横向溢出（表格自身滚动除外）
- [ ] 移动端底部标签栏、成员 Sheet 可用

### 无障碍

- [ ] 键盘 Tab 可聚焦所有交互元素，焦点环可见
- [ ] 图标按钮有可访问名称
- [ ] 图表有 `aria-label` / `<title>`
- [ ] 200% 缩放不横向溢出

### 数据与错误态

- [ ] `vstats: null` 的场次相关图表跳过或显示「—」
- [ ] 无评论 / 无 SC / 无逐字稿的空状态文案清晰
- [ ] 数据库不可用时页面显示错误态 + 可执行动作，不白屏
- [ ] 组首页查询失败时渲染错误态（当前是单条聚合查询，不做逐成员隔离）
- [ ] 控制台无未处理异常

### SEO / Agent

- [x] 单场页 HTML 含 title / description / canonical / OG / JSON-LD（2026-11-04 线上核对）
- [x] `sitemap.xml` 条数 = `3 + 5 × 成员数 + 单场数`（线上核对）
- [x] `robots.txt` 指向 `/sitemap.xml`
- [x] 对比页与未知路径 `noindex`
- [x] `/nonoka/stream/<id>.md` 返回 `text/markdown`，frontmatter 与逐字稿完整
- [x] 逐字稿正文可从 R2 binding 读取（`/api/transcripts/...` 200，`.md` 含正文）
- [x] R2 桶内对象完整（封面 / 表情 / archive / 逐字稿），CORS 允许站点域名与 localhost
- [x] 无稿场次 `.md` 写明没有稿件；未知 id 404 + `no-store`
- [x] `llms.txt` 包含成员与 `.md` 链接
- [x] HTML 单场页有 `<link rel="alternate" type="text/markdown">`

## 数据发布

- [ ] `bun run db:ingest` 成功；`bun run db:verify` 0 problems
- [ ] `bun run publish:assets` 成功；封面 / 表情 / archive 已上传
- [ ] 逐字稿有更新时 `bun run publish:transcripts` 成功
- [ ] `bun run purge:cache` 成功；页面与 `.md` 返回新数据
- [ ] `data-sources.json` 与新增成员 / 场次一致
- [ ] 会员限定场次的公开范围已确认（元数据公开，弹幕 / 评论 / SC 等明细默认隐藏）

## 缓存与部署

- [x] 第二次请求 `Cf-Cache-Status: HIT`（或 `REVALIDATED`）（2026-11-04 线上验证）
- [x] purge 端点拒绝无 token 请求（401）；正确 token 返回 200 且失效后回源
- [x] `wrangler deploy --config dist/server/wrangler.json` 后 `/`、成员页、单场页、`.md`、sitemap 正常（`ymmt.chilfish.top`）
- [x] 部署后缓存行为符合 `cross_version_cache` 配置（部署后冷缓存）
- [x] 新场次入库后不触发前端构建即可访问（`arale/9C8nEJPCjq0` 实测）
- [ ] `DATABASE_URL` 只在服务端读取；R2 凭据不进入客户端 bundle

## 文档一致性

- [ ] [docs/README.md](../README.md) 的索引链接都能打开
- [ ] 改动涉及的路径、命令、路由、字段名与代码一致
- [ ] 新增 / 移动 / 删除的文档已更新索引
- [ ] 已完成阶段方案已 `git mv` 到 `docs/archive/`
- [ ] `CHANGELOG.md` 的 Unreleased 已迁移到版本节
- [ ] 本次改动涉及的 postmortem 基线雷区已对照检查

## 发布步骤

1. 更新 `CHANGELOG.md`（Unreleased → 版本节）
2. 更新 `docs/README.md` 索引与文档一致性清单（如涉及）
3. 合并到 `main`
4. 跑 `deploy.yml`（或本地 `bun run cf:deploy`）
5. 在线上 URL 完成冒烟清单
6. 打 Tag：`git tag v0.1.0 && git push --tags`
7. 创建 GitHub Release，附变更摘要

## 回滚

- 代码：`wrangler rollback` 或重新部署上一版。
- 数据库：Neon 分支 / 时间点恢复；或按 `ingest_reports.id` 从 archive 重放。
- R2：版本控制，或从本地 `data/` 重新上传。
- 缓存：部署后按 tag purge；开 `cross_version_cache` 时尤其要 purge。
