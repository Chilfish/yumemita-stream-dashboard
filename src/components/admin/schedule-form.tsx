import type { FormEvent } from "react";
import type { DatasetOption, FormState } from "@/components/admin/schedule-form-state";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TimeInput } from "@/components/shared/time-input";
import { CONTENT_TYPE_LABELS, CONTENT_TYPES, type ContentTypeKey } from "@/lib/classify";
import { SCHEDULE_SLOTS, SLOT_LABELS } from "@/lib/schedule";

const KIND_ITEMS = [
  { label: "未指定", value: "none" },
  ...CONTENT_TYPES.map(kind => ({ label: CONTENT_TYPE_LABELS[kind], value: kind })),
];

const AVAILABILITY_ITEMS = [
  { label: "公开", value: "public" },
  { label: "会员限定", value: "subscriber_only" },
];

interface ScheduleFormProps {
  datasets: DatasetOption[];
  form: FormState;
  editingKey: string | null;
  saving: boolean;
  error: string | null;
  onChange: (patch: Partial<FormState>) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent) => void;
}

export function ScheduleForm({
  datasets,
  form,
  editingKey,
  saving,
  error,
  onChange,
  onReset,
  onSubmit,
}: ScheduleFormProps) {
  const datasetItems = datasets.map(dataset => ({
    label: dataset.label,
    value: dataset.id,
  }));

  return (
    <form className="flex flex-col gap-4 rounded-xl border border-hairline bg-card p-4 sm:p-5" onSubmit={onSubmit}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-headline text-foreground">{editingKey ? "编辑日程" : "新增日程"}</h2>
        {editingKey ? <span className="text-caption text-ink-3">{editingKey}</span> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="schedule-dataset">成员</FieldLabel>
          <Select
            disabled={Boolean(editingKey)}
            items={datasetItems}
            onValueChange={value => onChange({ datasetId: value ?? "" })}
            value={form.datasetId}
          >
            <SelectTrigger id="schedule-dataset">
              <SelectValue placeholder="选择成员" />
            </SelectTrigger>
            <SelectPopup>
              {datasetItems.map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="schedule-date">日期（JST）</FieldLabel>
          <Input
            id="schedule-date"
            nativeInput
            onChange={event => onChange({ date: event.target.value })}
            required
            type="date"
            value={form.date}
          />
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel>同场成员（可选）</FieldLabel>
          <ToggleGroup
            aria-label="同场成员"
            className="flex flex-wrap gap-1"
            multiple
            onValueChange={participants => onChange({ participants })}
            size="sm"
            value={form.participants}
          >
            {datasets
              .filter(dataset => dataset.id !== form.datasetId)
              .map(dataset => (
                <ToggleGroupItem key={dataset.id} value={dataset.id}>
                  {dataset.label}
                </ToggleGroupItem>
              ))}
          </ToggleGroup>
          <FieldDescription>
            联动场只按频道主占一行；这里选中的成员在日历与成员页也会看到这场。
          </FieldDescription>
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="schedule-title">标题</FieldLabel>
          <Input
            id="schedule-title"
            maxLength={200}
            onChange={event => onChange({ title: event.target.value })}
            placeholder="标题可以留空，例如：雑談 / 歌枠"
            value={form.title}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="schedule-kind">类型</FieldLabel>
          <Select
            items={KIND_ITEMS}
            onValueChange={value => onChange({
              kind: (value && value !== "none" && CONTENT_TYPES.includes(value as ContentTypeKey))
                ? value as ContentTypeKey
                : "none",
            })}
            value={form.kind}
          >
            <SelectTrigger id="schedule-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {KIND_ITEMS.map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel>时间</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl aria-label="时间精度">
              <SegmentedControlItem
                aria-current={form.timeMode === "slot" ? "page" : undefined}
                onClick={() => onChange({ timeMode: "slot" })}
              >
                时段
              </SegmentedControlItem>
              <SegmentedControlItem
                aria-current={form.timeMode === "time" ? "page" : undefined}
                onClick={() => onChange({ timeMode: "time" })}
              >
                精确时间
              </SegmentedControlItem>
            </SegmentedControl>

            {form.timeMode === "slot"
              ? (
                  <SegmentedControl aria-label="时段">
                    {SCHEDULE_SLOTS.map(slot => (
                      <SegmentedControlItem
                        aria-current={form.slot === slot ? "page" : undefined}
                        key={slot}
                        onClick={() => onChange({ slot })}
                      >
                        {SLOT_LABELS[slot]}
                      </SegmentedControlItem>
                    ))}
                  </SegmentedControl>
                )
              : (
                  <TimeInput
                    aria-label="精确时间"
                    className="w-32"
                    id="schedule-time"
                    onChange={value => onChange({ time: value })}
                    value={form.time}
                  />
                )}
          </div>
          <FieldDescription>
            只确定「晚上」这类时段时用时段模式；日历会显示时段，匹配真实场次时同样按时段。
            精确时间支持 9:30、930、下午3点等写法。
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="schedule-duration">预计时长（分钟）</FieldLabel>
          <Input
            id="schedule-duration"
            max={720}
            min={15}
            nativeInput
            onChange={event => onChange({ expectedMinutes: event.target.value })}
            placeholder="120"
            type="number"
            value={form.expectedMinutes}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="schedule-availability">可见性</FieldLabel>
          <Select
            items={AVAILABILITY_ITEMS}
            onValueChange={value => onChange({
              availability: value === "subscriber_only" ? "subscriber_only" : "public",
            })}
            value={form.availability}
          >
            <SelectTrigger id="schedule-availability">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="public">公开</SelectItem>
              <SelectItem value="subscriber_only">会员限定</SelectItem>
            </SelectPopup>
          </Select>
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="schedule-url">直播链接（可选）</FieldLabel>
          <Input
            id="schedule-url"
            onChange={event => onChange({ url: event.target.value })}
            placeholder="https://www.youtube.com/watch?v=…"
            value={form.url}
          />
          <FieldDescription>只作为外链展示，不参与主键与真实场次匹配。</FieldDescription>
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="schedule-note">备注</FieldLabel>
          <Textarea
            id="schedule-note"
            maxLength={500}
            onChange={event => onChange({ note: event.target.value })}
            placeholder="联动、延期、临时改期等"
            value={form.note}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-footnote text-foreground">
          <Switch
            checked={form.cancelled}
            onCheckedChange={checked => onChange({ cancelled: checked })}
          />
          取消这场
        </label>

        <div className="flex items-center gap-2">
          {editingKey ? (
            <Button onClick={onReset} size="sm" type="button" variant="ghost">
              取消编辑
            </Button>
          ) : null}
          <Button loading={saving} size="sm" type="submit">
            {editingKey ? "保存修改" : "添加日程"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-destructive-foreground text-footnote">{error}</p> : null}
    </form>
  );
}
