# 时间输入（TimeInput）

> 组件：`src/components/shared/time-input.tsx`
> 纯逻辑：`src/lib/time.ts`（测试：`src/lib/time.test.ts`）
> 使用位置：`/admin/schedule` 的「精确时间」模式

## 1. 何时使用

- 表单需要填写「时刻」（如 `9:30`），且允许用户直接键入。
- 需要保留键盘快速调整（`↑` / `↓`），同时提供可视化选择。

不要用于：

- 时长（`1 小时 30 分`）：用 `NumberField`，或单独解析 `1h30m`。
- 日期与时间组合：先用 `Calendar` 选日期，再用 `TimeInput` 选时刻。

## 2. 导入与基础用法

```tsx
import { TimeInput } from "@/components/shared/time-input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

<Field>
  <FieldLabel htmlFor="start-time">开始时间</FieldLabel>
  <TimeInput id="start-time" defaultValue="9:30" onChange={setTime} />
  <FieldDescription>支持 9:30、14:00、9am、下午3点</FieldDescription>
</Field>;
```

`TimeInput` 只渲染输入控件；label、说明与错误文案由外层 `Field` 提供。

## 3. 行为

### 3.1 输入解析

| 输入             | 结果    |
| ---------------- | ------- |
| `9`              | `09:00` |
| `930`            | `09:30` |
| `9:30` / `9.30`  | `09:30` |
| `9am` / `9 a.m.` | `09:00` |
| `12pm`           | `12:00` |
| `1:30pm`         | `13:30` |
| `下午3点30分`    | `15:30` |
| `０９：３０`     | `09:30` |

无法识别或越界（如 `24:00`、`9:60`）时不写回值，控件标记 `aria-invalid`，保留原文让用户修改。

### 3.2 提交时机

- 失焦或按 `Enter` 时解析并规范化。
- `onChange` 只在值合法时回调，始终是 24 小时制 `HH:mm`。
- 清空输入会回调空字符串。
- 在表单里按 `Enter` 会先提交当前值，再触发表单提交。

### 3.3 键盘

- `↑` / `↓` 按 `step` 调整分钟；跨午夜回绕（`23:50` 上调 10 分钟得到 `00:00`）。
- `Esc` 关闭浮层，焦点回到触发按钮。
- `Tab` 进入滚轮列后可逐个选项移动。

### 3.4 滚轮列

浮层由「小时 / 分钟 / 时段」三列组成，同一时刻只展示 5 行左右：

- 分钟列只列出能整除 60 的间隔，默认 10 分钟。
- 当前值居中显示；点击任意一项立即生效，浮层保持打开，可连续调整。
- 点击外部或按 `Esc` 关闭。
- 展示逻辑来自 Apple HIG：时间选择使用滚轮，分钟粒度需整除 60。

### 3.5 12 小时制

`hour12` 只影响展示（`2:30 PM`）与时段列；`value` / `onChange` 固定为 24 小时制 `HH:mm`，避免表单层再做转换。

## 4. Props

| Prop               | 类型                      | 默认        | 说明                                         |
| ------------------ | ------------------------- | ----------- | -------------------------------------------- |
| `value`            | `string`                  | —           | 受控值，`HH:mm`                              |
| `defaultValue`     | `string`                  | —           | 非受控初始值，支持宽容写法                   |
| `onChange`         | `(value: string) => void` | —           | 值变化，返回规范化的 `HH:mm`                 |
| `step`             | `number`                  | `10`        | 分钟间隔，需整除 60；非法值按 10 处理        |
| `hour12`           | `boolean`                 | `false`     | 以 12 小时制展示                             |
| `id` / `name`      | `string`                  | —           | 表单字段标识，`id` 配合 `FieldLabel htmlFor` |
| `placeholder`      | `string`                  | `例如 9:30` | 输入提示                                     |
| `disabled`         | `boolean`                 | `false`     | 禁用输入与选择器                             |
| `required`         | `boolean`                 | `false`     | 原生必填                                     |
| `className`        | `string`                  | —           | 传递给 `InputGroup`                          |
| `aria-label`       | `string`                  | —           | 没有可见 label 时提供可访问名称              |
| `aria-describedby` | `string`                  | —           | 关联说明或错误文案                           |

## 5. 可访问性

- 使用 `FieldLabel htmlFor` 与 `id` 关联；无可见 label 时传 `aria-label`。
- 非法输入通过 `aria-invalid` 暴露，错误文案由外层 `FieldError` 渲染。
- 滚轮列使用 `role="listbox"` / `role="option"` 与 `aria-selected`。
- 交互元素保留 `focus-visible:ring-2`；按钮在粗指针设备上的触控目标由 `Button` 的 `pointer-coarse` 样式保证不小于 44px。
- 图标为装饰，已标记 `aria-hidden`；触发按钮有 `aria-label`。

## 6. 约束

- `step` 只接受能整除 60 的值（1、2、3、4、5、6、10、12、15、20、30、60）；其他值按 10 处理。
- 当前值不在步进网格上时（如 `09:37`、`step=10`），分钟列仍会列出该值，避免丢失选中态。
- 不在 `InputGroup` 外层添加 padding；颜色只用 Token（`bg-background`、`text-muted-foreground`、`border-input` 等）。
- 新增解析格式时，先在 `src/lib/time.test.ts` 补能失败的用例，再改实现。
