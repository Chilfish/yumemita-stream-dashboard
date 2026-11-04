# UI 设计系统：总览与强制规范

> 目标：壳层安静，数据层保持密度；桌面与移动端都能快速扫读。
> 适用范围：所有页面、组件与交互。写 UI 前逐条自查。
> 完整的信息架构与设计理由见 [planning/ui-refactor.md](../planning/ui-refactor.md)；组件用法见 [GENERAL.md](./GENERAL.md)。

## 0. 写 UI 前的自检

- [ ] 先查 `src/components/ui/` 是否已有现成 coss 组件，不重复造
- [ ] 所有颜色来自 CSS 变量 / Token，无硬编码
- [ ] 浅色 / 深色同时成立
- [ ] 交互元素处理 hover（桌面）与 active（触屏）
- [ ] 类名用 `cn()` 合并
- [ ] 图标按钮有可访问名称，焦点环可见
- [ ] 空态、加载态、错误态与默认态一起交付
- [ ] 390 / 320px 无横向溢出（表格允许自身滚动）

## 1. 核心原则

1. **壳静，数据密**：导航、标题、按钮变安静；分析区域保留表格、明细与小字号标注。
2. **一屏一焦点**：每个屏幕只有一个主视觉。
3. **渐进披露**：用层级和子视图控制一次要看的东西，不靠删字段换简洁。
4. **分隔线优先于容器**：能用 1px 分隔线和留白分组的，不加边框、不加阴影。
5. **数字按排版处理**：数值右对齐、等宽，单位小一号、降一级颜色。
6. **成员色即强调色**：每位成员一个固定色相，图表主色继承成员色；强调面积 < 10%。

## 2. 颜色

颜色在 `src/styles/app.css` 的 `:root` 与 `.dark` 中成对定义，经 Tailwind v4 `@theme inline` 映射为 Token。

| Token | 用途 |
| --- | --- |
| `background` / `foreground` | 页面底色与正文 |
| `card` / `card-foreground` | 内容表面 |
| `popover` / `popover-foreground` | 菜单、弹窗、下拉 |
| `primary` / `primary-foreground` | 主操作、激活态 |
| `secondary` | 次要按钮 / 区域 |
| `muted` / `muted-foreground` | 弱化背景与辅助文字 |
| `accent` / `accent-foreground` | 选中 / 高亮 |
| `destructive` | 危险操作 |
| `border` / `input` / `ring` | 边框、输入框、焦点环 |
| `info` / `success` / `warning` | 状态提示 |
| `chart-1` … `chart-5` | 图表色 |
| `sidebar` 系列 | 侧边栏 |

规则：

```tsx
// ✅ Token
<div className="bg-background text-foreground">
  <p className="text-muted-foreground">辅助说明</p>
</div>

// ❌ 硬编码
<div className="bg-white text-black">
  <p className="text-gray-500">辅助说明</p>
</div>
```

- 不用 `dark:` 覆盖颜色；变量已在 `.dark` 切换。
- 新增颜色时同步写 `:root` 与 `.dark`。
- 图表最多 3 个色相：成员色 + 中性灰 + 一个语义色。

## 3. 排版

| 用途 | Token / 类 | 说明 |
| --- | --- | --- |
| 正文 | `font-sans` / `text-sm` / `text-base` | Noto Sans → 系统 sans |
| 标题 | `font-heading` | 与正文同族，靠字重区分 |
| 等宽 | `font-mono` | Geist Mono；只用于代码、时间码 |
| 页面标题 | 28/34，600 | 成员名、页面主标题 |
| 面板主信息 | 21/28，600 | 最近一场标题 |
| 主数字 | 24/30，600，tabular | 规模指标 |
| 辅助 | 11–12px，500，muted | 单位、日期、口径 |

- 数值用 `font-variant-numeric: tabular-nums`，右对齐。
- 中文行高 1.5–1.75；不用全大写英文作区块标题。
- 手机端最小 12px，桌面最小 11px；11px 不承载长句。

## 4. 间距与圆角

- 基准 4px：`1` = 4px、`2` = 8px、`3` = 12px、`4` = 16px、`6` = 24px。
- 内容最大宽 1320px；桌面左右边距 24–28px。
- 圆角：表面 14px、控件 9px、胶囊 999px。
- 阴影只保留 1 级；深色模式关闭阴影，用表面色差区分。
- 禁止边框 + 阴影 + 圆角同时出现在每个指标块上。

## 5. 动效

| 场景 | 时长 | 实现 |
| --- | --- | --- |
| hover / focus | 120ms | `transition-colors` |
| 按压 | 100ms | `scale: 0.975` |
| 路由切换 | 220ms | `opacity` + `translate 6px` |
| 单场子视图互换 | 170ms | `opacity` + `translate 3px` |
| 折线自绘 | 760ms | `pathLength="1"` + `stroke-dashoffset` |
| 柱子生长 | 480ms | `scaleY(0 → 1)` |
| 浮层进入 / 退出 | 220 / 150ms | coss 原语自带 |

- 只动 `opacity` / `translate` / `scale` / `stroke-dashoffset`。
- 数据入场动画只播一次，不循环、不做数字跳动。
- 尊重 `prefers-reduced-motion`。

## 6. 响应式

| 断点 | 布局 |
| --- | --- |
| ≥1180 | 侧栏 238 + 内容 1320；指标条 6 列；双栏 1.85:1 |
| 980–1180 | 指标条 3×2；双栏 1.55:1 |
| 640–980 | 侧栏收为 64px 图标轨道；双栏堆叠 |
| <640 | 隐藏侧栏；底部标签栏 + 成员 Sheet；左右 14px |

- 不因屏幕小隐藏功能；只改变呈现方式。
- 触控目标 ≥44px；底部标签栏处理安全区。
- 场次表窄屏可改两行式列表；图表按数据点密度横向滚动。

## 7. 组件索引

所有基础组件位于 `src/components/ui/`（coss-ui：Base UI + `useRender` + `mergeProps` + cva）。

- 布局与导航：`sidebar`、`breadcrumb`、`tabs`、`segmented-control`、`toolbar`、`menu`、`collapsible`、`accordion`、`scroll-area`
- 表单与输入：`button`、`input`、`input-group`、`textarea`、`select`、`combobox`、`autocomplete`、`checkbox`、`radio-group`、`switch`、`slider`、`number-field`、`toggle-group`、`calendar`、`field`、`form`
- 浮层与反馈：`dialog`、`alert-dialog`、`drawer`、`sheet`、`popover`、`tooltip`、`dropdown-menu`、`context-menu`、`command`、`toast`
- 数据展示：`card`、`table`、`badge`、`avatar`、`kbd`、`progress`、`meter`、`skeleton`、`empty`、`alert`、`pagination`、`separator`、`spinner`

具体用法与常见错误见 [GENERAL.md](./GENERAL.md)。

## 8. 可访问性

- 焦点环 2px `accent`，`outline-offset: 2px`；不允许 `outline: none` 无替代。
- 图标按钮必须有 `aria-label` 或显式文本。
- 表格行使用链接语义，支持 Tab + Enter，而不是 `tr onClick`。
- 空态说清：这里是什么、为什么空、下一步怎么做。
- 加载使用骨架屏，保留布局高度，避免 CLS。
- 200% 缩放不横向溢出。

## 9. 文案

界面文案按 [writing-style.md](../writing-style.md)：按钮用动词或名词短语；空态说三件事；错误提示给可执行动作；数字带单位。

## 10. 专题

- [chat-visualization.md](./chat-visualization.md)：弹幕与事件可视化组件的目标形态、数据契约、虚拟化、导入与正式化路径。当前 `/dev/live-chat` 只是 POC。
