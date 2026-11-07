# AI 生成界面的信息密度问题

调研日期：2026-11-07（JST）。范围：公开博客、设计社区讨论与产品观察。文中的机制解释来自从业者的经验总结，不是受控实验；引用时按「观察」使用，不当作定论。

## 摘要

AI 生成的页面常见一种固定形态：所有可用字段同时上屏，每个字段配一行说明，区块底部再补一段口径脚注，最后加几个「查看详情」入口。页面看起来完整，读者却找不到重点。

这类输出有三个共同来源：

1. 缺少取舍依据时，模型选择覆盖最多信息。
2. 训练语料让「解释」成为默认语态，说明文字容易从文档与代码注释漏进界面。
3. 模型逐组件生成，缺少页面级的注意力预算。

需要区分两件事：**数据可以密，解释必须少。** 问题通常出在密度太均匀：所有信息同样重要，每段信息都要再解释一遍，读者因此失去判断顺序。

## 1. 现象

| 信号 | 常见表现 | 读者的感受 |
| --- | --- | --- |
| 重复表述 | 同一个数字出现在卡片标题、读数行与底部脚注 | 不知道哪一处才是准的 |
| 口径脚注 | 区块底部解释统计范围、加权方式、列的含义 | 需要先读说明才能看懂页面 |
| 自证式导航 | 「查看详情 →」「进入成员主页 →」等重复入口 | 页面像在证明自己有用 |
| 字段驱动区块 | 数据表里的每个字段都能找到一个面板或图表 | 不知道先看哪个 |
| 均匀密度 | 所有区块同一字号、同一间距、同一视觉重量 | 眼睛没有落点 |
| 解释性副标题 | 标题下再写一句复述标题的话，如「其他成员 / 按最近更新排序」 | 读了两遍同一件事 |

这些信号经常一起出现。单独看每个组件都合理，合起来就变成一页没有主次的清单。

## 2. 外部观察

### 2.1 Hacker News：直接的读者反馈

一条引发多轮附和的评论写道：

> Every ai generated page tries to cram way too much information in way too small a place

同一条讨论下的回复集中在三点：

- 「often repeated/redundant information in many cases」，即同一信息反复出现。
- 「My eyes have no idea what to focus on」，即缺少视觉落点。
- 「Unnecessary information density」，即密度本身不是目的。

有人把这种页面称为「narrative UI」，意思是页面像在向读者交代背景，而不是让读者完成任务。这个说法没有形成稳定术语，但准确描述了「解释性文案占据界面」的观感。([Hacker News](https://news.ycombinator.com/item?id=50196368))

### 2.2 Kosta：AI 默认值清单

设计师 Kosta Canatselis 把 AI 生成界面的默认值列为几类，其中两条与信息密度直接相关：

- **Everything visible at all times**：AI 会把数据录入、导出、编辑面板同时摊开，理由是「用户迟早会用到其中某一个」，结果是没有逐步披露的路径。
- **Uniform everything**：所有区块用同样的圆角、内边距与高度，页面因此变得平，没有东西引导视线。

他的结论是：这些规则只是症状，真正缺的是「没有人停下来判断」。([Spot the Slop](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c))

### 2.3 Claude Design Me：不确定性导致信息最大化

一篇分析 AI 生成 dashboard 的文章给出了接近机制的解释：

> when the model is uncertain what the user actually wants to see, it defaults to the highest-information output rather than the most precisely targeted one, because the former looks more “complete” on the surface and is less likely to be criticized for missing something.

文章还指出，dashboard 比普通页面更容易出现这个问题：普通页面的元素有限，模型容易判断取舍；dashboard 的每个字段理论上都能成图，模型缺少「哪些字段重要」的上下文，就会全部画出来。([Why Do AI-Generated Dashboards Always Feel Overstuffed?](https://claudedesign-me.com/en/prompt-examples/ai-dashboard-prompt-mistakes-fixes/))

### 2.4 Fountain Institute：局部正确，全局失控

Fountain Institute 对 vibe-coded UI 的总结里，有一句可以直接拿来当判断标准：

> Locally it looks fine. Globally it's chaos.

每个卡片、每个色点、每个统计行单独看都没问题，但页面级的颜色预算、视觉重量与注意力分配无人负责。文章还指出，模型的训练目标是输出「看起来正确」的界面，而不是替某个具体产品做取舍。([7 Signs a UI Has Been Vibe Coded](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui))

### 2.5 BSWEN：负向约束比正向形容词有效

一篇反模式指南的经验是：让模型「做得简洁、专业、现代」通常无效，因为这些形容词会被平均掉；明确写出不要做什么，反而能改变输出。

> we ask for what we want without explicitly stating what we don't want. LLMs need negative constraints.

这条对本项目同样适用：与其写「界面要克制」，不如写「同一数字只出现一次」「不在界面写统计口径」。([How to Fix AI-Generated UI Designs](https://docs.bswen.com/blog/2026-03-20-ai-generated-ui-anti-patterns/))

### 2.6 Tufte：data-ink ratio

Edward Tufte 的 data-ink ratio 提供了另一种量化视角：图表中的墨水应尽量用于表达数据，删掉非数据墨水与重复的数据墨水。边框、背景、重复标签、装饰线都属于可删项。

这套原则原本针对图表，但「重复的数据墨水」与界面里的重复数字是同一类问题。页面上的每个标签、脚注与说明，都要回答它是否帮助读者读出数据。([Tufte's 6 Principles for Graphical Integrity](https://chartbuddy.io/blog/tuftes-principles-for-graphical-integrity))

### 2.7 Apple HIG：界面让位于内容

Apple Human Interface Guidelines 的三条基础原则是 clarity、deference、depth。其中 deference 的常见解释是：界面服务于内容，内容占据中心，装饰与控制不应与内容竞争。

这与信息密度问题直接相关。页面上解释口径的脚注、重复的导航入口与装饰性元信息，都是在和内容争夺注意力。([Apple HIG: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles))

### 2.8 uiscanner：平均值与缺少参考

uiscanner 把 AI slop 定义为「设计未被指定时，agent 退回的统计中位数」，并指出两个放大因素：

- 多数工具只产出一版草稿就停止，输出停留在第一次平均。
- 训练分布偏向常见的 SaaS 模板，模型缺少具体产品的设计参考。

有效的解法是给出明确的 Token、结构与参考页面，让模型没有空白可填；更花哨的形容词通常无效。([what is 'AI slop' UI](https://uiscanner.com/blog/what-is-ai-slop-ui))

## 3. 机制

| 机制 | 可观察的结果 | 对应约束 |
| --- | --- | --- |
| 缺省时选择信息最大化 | 所有字段都变成卡片、图表或读数 | 先定义这一屏回答的问题 |
| 漏报与多报的代价不对称 | 页面看起来「完整」，但重点被淹没 | 给区块、数字与动作设上限 |
| 没有用户模型 | 同时服务首次访问者、回访者与维护者 | 明确这一屏的目标读者与任务 |
| 逐组件生成，缺少页面预算 | 每个区块都合理，整页没有主次 | 生成后做整页层级检查 |
| 训练语料中的解释语态 | 口径说明、方法学脚注、交互提示进入界面 | 解释写进文档，界面只留结果 |
| 从数据模型长页面 | 字段存在就找位置，而不是先有读者问题 | 先写访问者问题，再选字段 |
| 一次生成即交付 | 第一版平均结果直接上线 | 固定一轮删除与人工复核 |

### 3.1 为什么脚注特别多

脚注是一个值得单独看的信号。模型知道某个数字有歧义，例如只统计公开场次、按时长加权、按周排列，于是选择在页面底部解释它。

这个选择在模型侧是合理的：解释比删除安全，删除会被视为丢失信息。但对读者来说，需要脚注才能理解的数字，通常说明它不该出现在这一屏。更彻底的处理是把口径写进数据文档，页面上只保留不需要解释就能读的数字。

## 4. 案例

### 4.1 组首页清理（本仓库，2026-11-07）

组首页曾同时包含规模脉冲、最近更新、成员入口、焦点场与成员面板。清理时删掉的内容可以按上面的信号归类：

| 删除项 | 信号 | 原因 |
| --- | --- | --- |
| `GroupPulse` | 字段驱动区块 | 与成员面板的累计指标重复 |
| `GroupRecentUpdates` | 字段驱动区块 | 与 Hero / 成员面板的最近场次重复 |
| `GroupMemberEntries` | 字段驱动区块 | 与 Hero 的成员入口重复 |
| Focus card 的播放 / SC / 同接一行 | 重复表述 | 下方读数已展示同样的数字 |
| 三处 `MemberDot` | 重复表述 | 头像与色条已经表达成员身份 |
| 「全组最新一场」「按最近更新排序」 | 解释性副标题 | 不改变读者判断 |
| 「单场详情 →」「进入 X 的首页 →」 | 自证式导航 | 标题本身就是链接 |
| `PanelNote` 三段 | 口径脚注 | 属于数据模型文档 |
| 页头的最近更新时间描述 | 重复表述 | 页面已有今日计划与最近场次 |

清理后页面顺序是：今日计划 → 全组焦点 → 成员面板。没有新增区块，核心信息仍在。这个例子说明，多数「信息」其实只是同一事实的不同写法。

### 4.2 通用 dashboard

常见形态是：顶部一排 6 个 KPI 卡片，下面 12 张图，每张图带副标题与脚注，底部再放一张明细表。模型通常能解释每张图的数据来源，但无法回答「这一屏先看什么」。

一个可执行的修正顺序：

1. 先写这一屏要回答的一个问题。
2. 只保留直接回答该问题的 3 到 5 个指标。
3. 其余字段放进详情页、展开区或 `.md` / API。
4. 删除所有需要脚注才能理解的数字。
5. 最后检查去掉 caption 后页面是否仍成立。

### 4.3 高密度何时合理

高密度不是错误。终端、日志、可观测性面板、财务表格都可以很密，但它们通常满足以下条件：

- 使用者是熟悉任务的专家。
- 信息位置稳定，多次使用后可以形成肌肉记忆。
- 对齐严格，数字等宽、右对齐、单位固定。
- 层级靠位置与字重建立，而不是靠更多说明。

不能把「数据密」当作跳过取舍的理由。专业工具的高密度来自稳定结构，不来自把所有字段都放上去。

## 5. 规避方法

| 问题 | 做法 | 验收 |
| --- | --- | --- |
| 不知道读者要什么 | 写一句「这一屏回答什么问题」 | 每个区块都能对应到这句话 |
| 想展示所有字段 | 设上限：区块数、数字数、每区块动作数 | 超出上限的字段有明确去处 |
| 想解释口径 | 口径写进数据文档 | 页面没有脚注也能读懂 |
| 想加导航 | 标题本身可点，一个区块一个动作 | 没有「详情 →」「进入 X →」 |
| 一次展示全部 | 渐进披露：首屏给答案，明细进展开或详情 | 首屏不需要滚动就能说出重点 |
| 人类与机器共用一页 | 分离视图：人类页面保持薄，完整数据走 `.md` / API | 页面没有为机器保留的冗余字段 |
| 正向形容词无效 | 写负向约束与具体上限 | 规则可检查，不依赖「简洁」这类判断 |
| 生成即完成 | 固定一轮删除与人工复核 | 净增行数有解释 |

验收动作可以很轻：

- **三秒测试**：三秒内能否说出这一屏是干什么的。
- **眯眼测试**：眯眼后能否看出一个主视觉。
- **删除测试**：逐个删掉 caption 与脚注，页面是否仍成立。
- **净增行数**：只加不减的改动需要说明新增信息为什么必须同时在场。

## 6. 结论

AI 生成页面的信息密度问题，表层是文案太多，底层是没有人做取舍。模型能生成组件，也能解释每个字段，但它不知道这一屏为谁服务、先回答什么、哪些信息可以晚一点出现。

可迁移的做法只有一条主线：**先定义问题，再给信息设预算，最后执行删除。** 数据可以密，解释必须少；同一事实只写一次；需要脚注的数字先从这一屏删掉。

本仓库的执行规则见 [信息密度与界面冗余](../ui-design/information-density.md)。

## 参考

| 来源 | 用途 |
| --- | --- |
| [Every AI generated page tries to cram way too much information — Hacker News](https://news.ycombinator.com/item?id=50196368) | 读者对重复信息与缺少焦点的直接反馈 |
| [Spot the Slop — Kosta Canatselis](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c) | 一次展示全部、均匀密度、缺少停顿 |
| [Why Do AI-Generated Dashboards Always Feel Overstuffed? — Claude Design Me](https://claudedesign-me.com/en/prompt-examples/ai-dashboard-prompt-mistakes-fixes/) | 不确定性导致信息最大化；dashboard 的结构性原因 |
| [7 Signs a UI Has Been Vibe Coded — Fountain Institute](https://www.fountaininstitute.com/blog/signs-vibe-coded-ui) | 局部正确、全局失控；平均化输出 |
| [How to Fix AI-Generated UI Designs — BSWEN](https://docs.bswen.com/blog/2026-03-20-ai-generated-ui-anti-patterns/) | 负向约束优于正向形容词 |
| [Tufte's 6 Principles for Graphical Integrity — Chartbuddy](https://chartbuddy.io/blog/tuftes-principles-for-graphical-integrity) | data-ink ratio 与重复数据墨水 |
| [Apple HIG: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles) | clarity、deference、depth |
| [what is 'AI slop' UI — uiscanner](https://uiscanner.com/blog/what-is-ai-slop-ui) | 统计中位数、单次草稿、缺少参考 |

## 检索说明

- 检索时间：2026-11-07。
- 关键词：AI generated UI too much information、AI slop dashboard、vibe coded UI、information density、data-ink ratio、Apple HIG deference。
- 资料以从业者博客与社区讨论为主，没有找到针对该现象的受控实验。引用时保留原始措辞，机制部分标注为解释而非结论。
- 来源链接可能随站点调整失效；失效时保留标题与出处，便于重新检索。
