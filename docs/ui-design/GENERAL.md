# 通用组件设计规范（General Components）

> 原则：基础 UI 优先使用 `src/components/ui/` 下的 coss-ui 组件，不手写裸 `<div>` / `<button>` 模拟已有组件。
> 基础：Base UI（无头无障碍原语）+ Tailwind CSS + cva。组件已内置可访问性、焦点管理与默认样式。
> 参考：<https://coss.com/ui/llms.txt>

## 0. 全局规则

### 0.1 导入路径

当前仓库使用 `@/*` 别名：

```tsx
// ✅ 正确
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";

// ❌ 错误
import { Button } from "../../components/ui/button";
```

当前别名是 `@/*`；不要改成 `~/*`，也不要混用两种写法。

### 0.2 类名工具

```tsx
import { cn } from "@/lib/utils";

<div className={cn("base-class", condition && "conditional-class", className)} />;
```

### 0.3 不擅自加 padding

coss 组件内部已处理结构与间距。外层再包一层 padding 容易破坏对齐；需要调整时用组件已有的 `className` 或 `CardHeader` / `CardPanel` 等分区。

## 1. 按钮（Button）

导入：`@/components/ui/button`

| Variant | 使用场景 |
| --- | --- |
| `default` | 页面唯一的首要操作 |
| `secondary` | 次要操作（取消、返回、重置） |
| `outline` | 中性操作（导出、预览、页面跳转） |
| `ghost` | 工具栏、行内操作、图标按钮 |
| `destructive` | 不可逆的危险操作 |
| `destructive-outline` | 次要危险操作 |
| `link` | 文字链接式按钮 |

| Size | 高度 | 场景 |
| --- | --- | --- |
| `xs` | `h-7` | 紧凑表格、批量操作 |
| `sm` | `h-8` | 工具栏、卡片 footer |
| `default` | `h-9` | 表单提交、对话框 |
| `lg` | `h-10` | 大卡片 CTA |
| `icon-xs` … `icon-xl` | `size-7` … `size-11` | 纯图标按钮 |

```tsx
<Button variant="default">提交</Button>
<Button variant="ghost" size="icon-sm" aria-label="设置"><SettingsIcon /></Button>
<Button loading>保存中…</Button>

// ❌ 禁止手写按钮样式
<button className="rounded bg-blue-500 px-4 py-2 text-white">确认</button>
```

## 2. 输入框（Input）

导入：`@/components/ui/input`

```tsx
<Input placeholder="请输入用户名" />
<Input size="sm" placeholder="紧凑尺寸" />
<Input disabled placeholder="不可编辑" />
```

- `size`：`sm` / `default` / `lg`。
- `className` 作用在外层容器；需要直接调整原生输入时用 `[&_input]:*`。
- `unstyled` 去掉外层边框与背景；`nativeInput` 渲染原生 `<input>`。

带前缀 / 后缀时优先使用 `InputGroup`：

```tsx
import { SearchIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

<InputGroup>
  <InputGroupAddon align="inline-start">
    <SearchIcon className="size-4" />
  </InputGroupAddon>
  <InputGroupInput placeholder="搜索…" aria-label="搜索" />
</InputGroup>;
```

## 3. 卡片（Card）

```tsx
import {
  Card, CardAction, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle,
} from "@/components/ui/card";

<Card>
  <CardHeader>
    <CardTitle>标题</CardTitle>
    <CardDescription>描述文字</CardDescription>
    <CardAction><Badge variant="info">状态</Badge></CardAction>
  </CardHeader>
  <CardPanel>主要内容</CardPanel>
  <CardFooter>
    <Button variant="outline">取消</Button>
    <Button>确认</Button>
  </CardFooter>
</Card>;
```

- `CardPanel` 等价导出为 `CardContent`。
- 需要把多个卡片拼成一个面板时用 `CardFrame` 系列。
- 不要在 `CardPanel` 内再嵌 `Card`；需要分区时用多个 Card 或 `Separator`。

## 4. 浮层（Overlays）

### 4.1 Dialog

```tsx
import {
  Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

<Dialog open={open} onOpenChange={setOpen}>
  <DialogPopup>
    <DialogHeader>
      <DialogTitle>确认删除</DialogTitle>
      <DialogDescription>此操作不可撤销。</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="ghost">取消</Button>
      <Button variant="destructive">删除</Button>
    </DialogFooter>
  </DialogPopup>
</Dialog>;
```

- `DialogPopup` 默认带背景模糊、进出动画与右上角关闭按钮。
- `bottomStickOnMobile` 默认开启：`<768px` 时固定在底部。
- 长内容用 `DialogPanel`（内部带 `ScrollArea`）。

### 4.2 AlertDialog

破坏性操作确认使用 `AlertDialog`，不要用普通 `Dialog`。

### 4.3 Drawer / Sheet

- `Drawer`：底部 / 侧边抽屉，支持拖拽关闭与 `position`；`showBar` 显示顶部拖拽条。
- `Sheet`：侧面板，`side` 为 `left` / `right` / `top` / `bottom`。
- 移动端优先使用 Drawer，桌面端用 Dialog 或 Sheet。

### 4.4 Toast

```tsx
import { ToastProvider, AnchoredToastProvider, toastManager } from "@/components/ui/toast";

<ToastProvider>
  <AnchoredToastProvider>{children}</AnchoredToastProvider>
</ToastProvider>;
```

- Provider 必须在触发 toast 的组件树内挂载。
- 当前没有全局挂载；新页面要用 toast，就在该页面或岛屿内挂载。

## 5. 图标

- 库：`lucide-react`
- 默认 `size-4`（16px）；辅助图标 `text-muted-foreground`。
- 禁止 `text-black` / `text-white` 硬编码颜色。

```tsx
<SearchIcon className="size-4 text-muted-foreground" />
<SettingsIcon className="size-5" />
```

## 6. 工具函数

### 6.1 `cn()`

```tsx
import { cn } from "@/lib/utils";
<div className={cn("base-style", variant === "primary" && "text-primary", className)} />;
```

### 6.2 `useMediaQuery`

```tsx
import { useMediaQuery } from "@/hooks/use-media-query";

useMediaQuery("lg");
useMediaQuery("max-md");
useMediaQuery({ min: "md", max: "xl" });
useMediaQuery({ pointer: "coarse" });
```

## 7. 响应式数据表格

记录型列表（日程、场次、成员）在窄屏不要压缩表格：固定列宽会把标题列挤成一字一列。
统一形态是「桌面表格 + 移动端堆叠列表」，分界点 `md`（768px）。

### 7.1 结构

```tsx
<div className="hidden md:block">
  <Table>…</Table>
</div>

<ul className="md:hidden">
  {rows.map(row => (
    <li className="flex flex-col gap-1.5 border-t border-hairline px-4 py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <span className="text-caption tabular-nums text-ink-3">{time}</span>
        <span className="text-footnote font-medium">{member}</span>
        <Badge size="sm">{state}</Badge>
      </div>
      <p className="text-footnote leading-snug">{title}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-ink-3">{relation}</span>
        <RowActions />
      </div>
    </li>
  ))}
</ul>
```

- 同一行内容拆成共享小组件（状态 Badge、关联状态、操作按钮），桌面与移动端复用，不写两份判断。
- 移动端行内顺序：元信息（时间 / 成员 / 状态）→ 标题（换行，不截断）→ 备注 → 关联 / 操作。
- 日期分组标题放在两种形态之外，共用一份。
- 参考实现：`src/components/admin/schedule-list.tsx`。

### 7.2 规则

| 规则 | 原因 |
| --- | --- |
| 标题列不设固定宽度、不用 `truncate` | 窄屏会把标题压成一字一列 |
| `<md` 不渲染表格，改堆叠列表 | 表格横向滚动或压缩都难读 |
| 列表行用分隔线分组，不加卡片 | 保持密度，避免卡片堆 |
| 触控目标 ≥44px（`Button` 已带 `pointer-coarse`） | 移动端可点 |
| 页面级无横向滚动 | 宽内容在自身容器内滚动 |
| 用 iPhone 设备档（DPR + touch）验证 320 / 390 宽 | 只缩桌面视口看不出问题 |

真正的宽数据表（图表、热力图、多指标矩阵）才用 `overflow-x-auto` 容器内滚动；记录列表一律切换形态。

## 8. 常见错误速查

| 错误 | 正确做法 |
| --- | --- |
| `<button className="bg-blue-500 text-white">` | `<Button>` |
| 绝对定位图标 + 手写 `pl-8` | `<InputGroup>` + `<InputGroupAddon>` |
| `<div className="rounded-xl border bg-white p-6">` | `<Card><CardPanel>…</CardPanel></Card>` |
| `text-black dark:text-white` | `text-foreground` |
| `bg-white dark:bg-gray-900` | `bg-background` / `bg-card` |
| `<hr />` 分割区域 | `<Separator />` |
| 手写弹层 / 下拉 | `Dialog` / `Menu` / `Select` / `Popover` |
| 窄屏把表格压到标题列一字一行 | `md` 以下改堆叠列表（见 [§7](#7-响应式数据表格)） |
| 同一数字在 caption、读数与脚注里各写一遍 | 只保留层级最高的一处（见 [information-density.md](./information-density.md)） |
| 在区块底部解释统计口径 | 口径写进 `docs/data/data-model.md`，界面只展示结果 |
| 「单场详情 →」「进入 X 的首页 →」 | 标题本身可点，一个区块最多一个动作 |
| 新面板与已有面板回答同一个问题 | 先写这一屏回答的问题，重复区块删掉 |
| 在未挂载 Provider 的组件里调用 toast | 先挂载 `ToastProvider` |
| 导入 `@/components/ui/button` 以外的手写按钮 | 统一用 coss `Button` |
