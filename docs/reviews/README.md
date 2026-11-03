# 代码审查记录（Reviews）

按次记录代码审查。审查问题按严重度分级（Z/R/E/U，见模板），并登记进 [planning/backlog.md](../planning/backlog.md) 的「审查承接区」排期。

## 约定

- 文件名：`review-YYYY-MM-DD-<主题>.md`，从 [TEMPLATE.md](./TEMPLATE.md) 复制。
- 时机：里程碑、阶段或较大重构完成后做一次；不必每次小改动都写。
- 每条问题带编号、文件位置和建议修法。
- 已修问题在原记录中勾选并注明 commit。
- 同类问题复发时升级为 postmortem，或同步到基线雷区。
- 审查结论只写事实：审了什么、发现了什么、修了什么、哪些没修。

## 审查清单（Astro 迁移阶段）

- [ ] 路由：新增页面已在 `src/pages/` 建立 `.astro`；深链可刷新；旧地址兼容
- [ ] URL 状态：表格筛选 / 单场分段 / 对比 ids 可分享、可前进后退
- [ ] 数据：三态覆盖；远端失败有回退与来源提示
- [ ] 数据口径：`null` 不被画成 0；币种不换算；时间按 JST
- [ ] 组件：复用 `src/components/ui/`；未改生成文件里的业务逻辑
- [ ] 设计 Token：无硬编码颜色，浅色 / 深色同时成立
- [ ] 无障碍：焦点可见，图标按钮有可访问名称，图表有 `aria-label`
- [ ] 性能：没有为单个数字拉完整 manifest；大文件不进首屏
- [ ] 安全：R2 / 数据库凭据不进客户端 bundle；不渲染不可信 Markdown
- [ ] 验证：`bun run check`、`bun run build` 通过；相关页面手工走查
- [ ] 文档已同步：`docs/README.md` 索引、相关文档、`CHANGELOG.md`
- [ ] 文案符合 [writing-style.md](../writing-style.md)
- [ ] 路径、命令、路由与代码一致；无死链
- [ ] 新 Bug 模式已写 postmortem

## 审查清单（迁移到 Astro 后追加）

- [ ] 每页显式声明 `prerender`，数据页为 `false`
- [ ] `client:*` 指令与交互需求匹配；`client:only` 未承载首屏正文
- [ ] 岛屿 props 可序列化；`.astro` frontmatter 不读 `window`
- [ ] 服务端密钥只从 `astro:env/server` 读
- [ ] 数据页有缓存指令与 tag；ingest 后有 purge
- [ ] `.md` 路由返回 `text/markdown`，`noindex`，不进 sitemap
- [ ] 导航用 `<a href>` + ClientRouter，无 `window.location.href`
- [ ] 预渲染页面与按需页面没有共享跨请求缓存

## 索引

| 日期 | 范围 | 分支 / commit | 摘要 |
| --- | --- | --- | --- |
| （YYYY-MM-DD） | （审查范围） | `main @ <hash>` | （一句话） |

> 尚无审查记录。首次审查后在此登记。

## 审查方式

- 多轴视角：路由与渲染 / 数据与回退 / 安全 / 资源纪律 / 构建部署 / UI 体验。
- 对照 [postmortem/README.md](../postmortem/README.md) 的「基线雷区」检查已修或复发。
- 上轮问题逐条核验，避免「审了不改」。
