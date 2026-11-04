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

迁移到 Astro 模板后，别名改为 `~/*`，届时统一替换，不在功能提交里混改。

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

## 7. 常见错误速查

| 错误 | 正确做法 |
| --- | --- |
| `<button className="bg-blue-500 text-white">` | `<Button>` |
| 绝对定位图标 + 手写 `pl-8` | `<InputGroup>` + `<InputGroupAddon>` |
| `<div className="rounded-xl border bg-white p-6">` | `<Card><CardPanel>…</CardPanel></Card>` |
| `text-black dark:text-white` | `text-foreground` |
| `bg-white dark:bg-gray-900` | `bg-background` / `bg-card` |
| `<hr />` 分割区域 | `<Separator />` |
| 手写弹层 / 下拉 | `Dialog` / `Menu` / `Select` / `Popover` |
| 在未挂载 Provider 的组件里调用 toast | 先挂载 `ToastProvider` |
| 导入 `@/components/ui/button` 以外的手写按钮 | 统一用 coss `Button` |
