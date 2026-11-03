# Release Checklist

**项目**：yumemita-stream-dashboard | **最后更新**：2026-11-03

> 当前部署目标：静态托管（Vercel / 任意静态托管）+ R2 数据。迁移到 Cloudflare Workers 后，用本文末尾的「迁移后备注」替换部署与冒烟命令。
> 目标：每个里程碑在真实环境验证通过，不留已知回归。

## 版本纪律

- 版本号单一来源：`package.json` 的 `version`。
- 只在验证门禁通过后打 tag：`git tag v0.1.0 && git push --tags`。
- `CHANGELOG.md` 的 Unreleased 节在发布前迁移到版本节。

## 验证门禁（发布前必过）

- [ ] `bun run check` 通过（typecheck + test + lint）
- [ ] `bun run build` 通过
- [ ] `bun run validate:data` 通过（改数据时必跑）
- [ ] `bun run verify:seo` 通过（改路由 / SEO / 构建时必跑）
- [ ] 涉及页面的改动已在 `bun run dev` 或 `vite preview` 下手动走查，并记录路径与结果
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
- [ ] `/:datasetId/transcripts` 与有稿单场的逐字稿分段正常；时间码跳转正确
- [ ] 不存在的路径返回 404；不存在的 dataset / videoId 有明确提示
- [ ] 旧 `#/...` 链接能改写成真实路径

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

### 数据与降级

- [ ] 数据来自 R2 时，页面标明来源
- [ ] 阻断 `VITE_DATAPACK_BASE` 或远端不可达时，回退到 `public/data/` 快照且页面不白屏
- [ ] `vstats: null` 的场次相关图表跳过或显示「—」
- [ ] 无评论 / 无 SC / 无逐字稿的空状态文案清晰
- [ ] 控制台无未处理异常

### SEO

- [ ] 单场页 HTML 含 title / description / canonical / OG
- [ ] `sitemap.xml` 条数 = `2 + 6 × 成员数 + 单场数`（当前口径，见 [deployment.md](./deployment.md)）
- [ ] `robots.txt` 指向 `/sitemap.xml`
- [ ] 对比页与未知路径 `noindex`
- [ ] 静态分享卡片使用最新构建的数据

## 数据发布

- [ ] `bun run publish:data` 成功；manifest / insights 由 pack 派生，未手改
- [ ] `bun run validate:data -- --remote` 通过
- [ ] 逐字稿有更新时 `bun run publish:transcripts` 成功
- [ ] 封面变体（480 / 960 / 1280w）已上传，缺变体只警告
- [ ] `data-sources.json` 与新增成员 / 场次一致
- [ ] 会员限定内容范围已确认

## 文档一致性

- [ ] [docs/README.md](../README.md) 的索引链接都能打开
- [ ] 改动涉及的路径、命令、路由、字段名与代码一致
- [ ] 新增 / 移动 / 删除的文档已更新索引
- [ ] 已完成阶段方案已 `git mv` 到 `docs/archive/`
- [ ] `CHANGELOG.md` 的 Unreleased 已迁移到版本节
- [ ] [writing-style.md](../writing-style.md) 的提交前检查命中项已人工处理
- [ ] 本次改动涉及的 postmortem 基线雷区已对照检查

## 发布步骤

1. 更新 `CHANGELOG.md`（Unreleased → 版本节）
2. 更新 `docs/README.md` 索引与文档一致性清单（如涉及）
3. 合并到 `main`
4. 按当前托管方式部署 `dist/`（Vercel 项目或静态托管）
5. 在部署 URL 上完成冒烟清单
6. 打 Tag：`git tag v0.1.0 && git push --tags`
7. 创建 GitHub Release，附变更摘要

## 回滚

- 静态站：重新部署上一版 `dist/`。
- 数据：恢复 R2 上一版对象，或把本地 pack 放回去重新 `publish:data`。
- 迁移到 Workers 后：`wrangler rollback`；数据库从 Neon 分支 / 时间点恢复；缓存按 tag purge。

## 迁移后备注

迁移到 Astro + Cloudflare Workers 后，本节替换上面的验证与部署命令：

- [ ] `astro check` / `bun run build` 通过
- [ ] `GET /:datasetId/stream/:videoId.md` 返回 `text/markdown`，frontmatter 与逐字稿完整
- [ ] 未知 `.md` 返回 404，`X-Robots-Tag: noindex`
- [ ] `Cf-Cache-Status` 命中符合预期；ingest 后 purge 生效
- [ ] `wrangler deploy` 后 `/`、成员页、单场页、`.md`、sitemap 正常
- [ ] 数据库不可用时页面显示错误态，不是白屏
- [ ] 新场次入库后不触发前端构建即可访问
