---
编号: 005
主题: 移除 CJK webfont 后字体栈顺序错误，简体中文在 Windows 上落到日文字形
日期: 2026-11-15
严重级别: SEV-2
分类: 缺陷
状态: Mitigated
根因归类: 依赖隐式默认
---

# 005 — 移除 CJK webfont 后字体栈顺序错误，简体中文在 Windows 上落到日文字形

## 摘要

为修 LCP 去掉了自托管的 `@fontsource-variable/noto-sans-sc`（101 个 woff2 子集 / 4.29 MB），
中日文改为系统字体回落。字体栈里 `"Yu Gothic UI"`（Windows 日文）排在 `"Microsoft YaHei"`
（Windows 简中）前面，于是 Windows 上**所有简体字都用了日文字形**：直 / 说 / 剧 / 者 等
中日字形有分歧的汉字明显串味，整屏中文看起来像日文排版。

之前没暴露，是因为 Noto Sans SC 覆盖了全部 CJK，栈里后面的顺序从来没被走到过。

## 影响

- 【用户可见】Windows 用户（含 Chrome / Edge）全站中文正文字形错误，视觉上像日文页面。
- 【范围】只在中文缺字时才会走到 `sans-serif` 的场景不受影响；受影响的是 Windows 上全部简体中文。
- 【未影响】macOS（PingFang SC 排在 Hiragino 前）、移动端（Noto Sans CJK SC 在前）本就正确，
  所以跨平台冒烟容易漏掉——只有 Windows 会看到。

## 时间线

| 日期 / commit | 事件 |
| --- | --- |
| 2026-11-15 | `fbd3d55` 移除 `noto-sans-sc`，字体栈改为 Noto Sans + 系统 CJK |
| 2026-11-15 | 自查只验证了构建产物（`@font-face` 101 → 8、CSS 390 → 282 KB）与首屏指标，**没看实际字形** |
| 2026-11-15 | 用户贴截图：中文正文呈日文字形 |
| 2026-11-15 | 定位为字体栈顺序问题，把中文系统字体全部提到日文字体之前 |

## 根因分析（blameless）

1. 原字体栈里同时列了中日两种系统字体，但**从未被验证过**——第一个 CJK 字体（Noto Sans SC webfont）
   永远能命中，后面的顺序是死代码。删掉第一个之后，死代码直接变成了默认行为。
2. 验证方式只覆盖了「体积变小」「构建通过」这类可量化信号，**没有覆盖「字形是否正确」**。
   字体是纯观感产物，指标全绿也不代表对。
3. 字体栈是跨平台隐式默认：同一份 CSS 在 macOS / Windows / Android 上命中不同字体，
   而开发机与 CI 都不会暴露差异。

## 触发条件

`--font-sans` 里存在多个 CJK 候选字体，且中日字体的相对顺序与页面主要语言不一致。
本站 `html lang="zh-CN"`，日文只出现在场次标题与人名里。

## 修复

- `src/styles/app.css`：把中文系统字体整体提到日文字体之前，并在注释里写明「顺序即优先级」：
  `PingFang SC → Hiragino Sans GB → Microsoft YaHei UI → Microsoft YaHei → Noto Sans CJK SC
  → Source Han Sans SC → Yu Gothic UI → Hiragino Sans → Noto Sans CJK JP`。
- 用 headless Chrome 截图核对字形（`/about`、`/`），确认简体字回到雅黑 / 苹方字形。

## 预防

1. **基线雷区**新增：换字体、改字体栈、删字体包后，必须在**声明的主语言**下截图核对字形，
   而不是只看体积与构建。见 [README.md](./README.md) §3「样式与 UI」。
2. 字体栈里出现多个 CJK 候选时，注释写明顺序原因；顺序不是随手排的。
3. 已知取舍：日文标题与人名现在用中文字体渲染，少数汉字（直 / 骨 / 次 等）会呈现简中字形。
   若要两者都正确，需要给日文内容加 `lang="ja"` 并用 `:lang(ja)` 指定日文字体——
   目前没做，属于已知限制而非缺陷。

## 相关

- 审计背景：[seo-audit-2026-11-15.md](../research/seo-audit-2026-11-15.md) 第五节。
