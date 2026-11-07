import type * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  createMinuteOptions,
  formatTime,
  normalizeMinuteStep,
  normalizeTime,
  parseTime,
  stepTime,
} from "@/lib/time";
import { cn } from "@/lib/utils";

const DEFAULT_PLACEHOLDER = "例如 9:30";
const DEFAULT_STEP = 10;

export interface TimeInputProps {
  /** 输入框 id，配合 `FieldLabel htmlFor` 使用 */
  "id"?: string;
  /** 表单字段名 */
  "name"?: string;
  /** 受控值，格式为 `HH:mm` */
  "value"?: string;
  /** 非受控初始值，支持 `930`、`下午3点` 等写法 */
  "defaultValue"?: string;
  /** 值变化回调，始终返回规范化的 `HH:mm` */
  "onChange"?: (value: string) => void;
  /** 分钟间隔，需整除 60（如 10、15、30），非法值回退为 10 */
  "step"?: number;
  /** 以 12 小时制展示 */
  "hour12"?: boolean;
  "placeholder"?: string;
  "disabled"?: boolean;
  "required"?: boolean;
  "className"?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/**
 * 时间输入框：单输入框宽容解析 + 分列滚轮选择。
 *
 * - 输入支持 `9`、`930`、`9:30`、`9am`、`下午3点` 等写法，失焦后规范化
 * - `onChange` 始终返回 24 小时制的 `HH:mm`
 * - `↑` / `↓` 按 `step` 调整；滚轮只列出能整除 60 的分钟间隔
 *
 * @example
 * ```tsx
 * <Field>
 *   <FieldLabel htmlFor="start-time">开始时间</FieldLabel>
 *   <TimeInput id="start-time" defaultValue="9:30" onChange={setTime} />
 *   <FieldDescription>支持 9:30、14:00、9am</FieldDescription>
 * </Field>
 * ```
 */
export function TimeInput({
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
  className,
  defaultValue,
  disabled = false,
  hour12 = false,
  id,
  name,
  onChange,
  placeholder = DEFAULT_PLACEHOLDER,
  required = false,
  step = DEFAULT_STEP,
  value,
}: TimeInputProps): React.ReactElement {
  const [internalValue, setInternalValue] = useState(
    () => normalizeTime(defaultValue ?? "") ?? "",
  );
  const [draft, setDraft] = useState(() =>
    toDisplay(value ?? defaultValue ?? "", hour12));
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const focused = useRef(false);

  const current = value ?? internalValue;

  useEffect(() => {
    if (focused.current) return;
    setDraft(toDisplay(current, hour12));
    setInvalid(false);
  }, [current, hour12]);

  const minuteStep = normalizeMinuteStep(step);
  const selectedMinutes = useMemo(() => parseTime(current), [current]);
  const selectedHour = useMemo(
    () => getHourOption(selectedMinutes, hour12),
    [selectedMinutes, hour12],
  );
  const selectedMinute = selectedMinutes === null
    ? null
    : pad(selectedMinutes % 60);
  const selectedPeriod = selectedMinutes === null
    ? null
    : Math.floor(selectedMinutes / 60) < 12
      ? "AM"
      : "PM";

  const hourOptions = useMemo(
    () => Array.from(
      { length: hour12 ? 12 : 24 },
      (_, index) => (hour12 ? String(index + 1) : pad(index)),
    ),
    [hour12],
  );
  const minuteOptions = useMemo(() => {
    const options = createMinuteOptions(minuteStep);
    if (selectedMinute !== null && !options.includes(selectedMinute)) {
      options.push(selectedMinute);
    }
    return options.sort();
  }, [minuteStep, selectedMinute]);

  function applyMinutes(minutes: number): void {
    const next = formatTime(minutes);
    setDraft(formatTime(minutes, hour12));
    setInvalid(false);
    setInternalValue(next);
    onChange?.(next);
  }

  function commit(): void {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft("");
      setInvalid(false);
      setInternalValue("");
      onChange?.("");
      return;
    }

    const minutes = parseTime(trimmed);
    if (minutes === null) {
      setInvalid(true);
      return;
    }

    applyMinutes(minutes);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      commit();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    event.preventDefault();
    const minutes = parseTime(draft) ?? parseTime(current) ?? 9 * 60;
    applyMinutes(stepTime(minutes, minuteStep, event.key === "ArrowUp" ? 1 : -1));
  }

  function selectHour(option: string): void {
    const base = selectedMinutes ?? 9 * 60;
    const minute = base % 60;
    if (hour12) {
      const period = base < 12 * 60 ? "AM" : "PM";
      const hour = (Number(option) % 12) + (period === "PM" ? 12 : 0);
      applyMinutes(hour * 60 + minute);
      return;
    }
    applyMinutes(Number(option) * 60 + minute);
  }

  function selectMinute(option: string): void {
    const base = selectedMinutes ?? 9 * 60;
    applyMinutes(Math.floor(base / 60) * 60 + Number(option));
  }

  function selectPeriod(option: string): void {
    const base = selectedMinutes ?? 9 * 60;
    const hour = (Math.floor(base / 60) % 12) + (option === "PM" ? 12 : 0);
    applyMinutes(hour * 60 + (base % 60));
  }

  return (
    <InputGroup className={className}>
      <InputGroupInput
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        className="tabular-nums"
        disabled={disabled}
        id={id}
        inputMode="numeric"
        name={name}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onFocus={() => {
          focused.current = true;
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        type="text"
        value={draft}
      />

      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={(
              <Button
                aria-label="选择时间"
                disabled={disabled}
                size="icon-xs"
                variant="ghost"
              />
            )}
          >
            <ChevronDownIcon
              className={cn(
                "size-4 text-muted-foreground transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </PopoverTrigger>

          <PopoverPopup
            align="end"
            className="w-fit [--viewport-inline-padding:--spacing(2)] [&_[data-slot=popover-viewport]]:py-2"
          >
            <PopoverTitle className="sr-only">选择时间</PopoverTitle>
            <div className="flex items-center justify-center gap-1">
              <TimeColumn
                active={open}
                label="小时"
                onSelect={selectHour}
                options={hourOptions}
                value={selectedHour}
              />
              <TimeColumn
                active={open}
                label="分钟"
                onSelect={selectMinute}
                options={minuteOptions}
                value={selectedMinute}
              />
              {hour12 && (
                <TimeColumn
                  active={open}
                  label="时段"
                  onSelect={selectPeriod}
                  options={["AM", "PM"]}
                  value={selectedPeriod}
                />
              )}
            </div>
          </PopoverPopup>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  );
}

interface TimeColumnProps {
  active: boolean;
  label: string;
  options: readonly string[];
  value: string | null;
  onSelect: (value: string) => void;
}

function TimeColumn({
  active,
  label,
  options,
  value,
  onSelect,
}: TimeColumnProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    const item = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!container || !item) return;

    let innerFrame = 0;
    const frame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        container.scrollTop
          += itemRect.top
            - containerRect.top
            - (container.clientHeight - itemRect.height) / 2;
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(innerFrame);
    };
  }, [active, value]);

  return (
    <div
      aria-label={label}
      className={cn(
        "relative flex h-40 w-11 flex-col gap-0.5 overflow-y-auto py-16",
        "[mask-image:linear-gradient(to_bottom,transparent,black_15%,black_85%,transparent)]",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      ref={containerRef}
      role="listbox"
    >
      {options.map(option => (
        <Button
          key={option}
          aria-selected={option === value}
          className={cn(
            "h-8 w-full shrink-0 tabular-nums",
            option === value
              ? "bg-accent font-medium text-foreground"
              : "text-muted-foreground",
          )}
          onClick={() => onSelect(option)}
          role="option"
          size="xs"
          variant="ghost"
        >
          {option}
        </Button>
      ))}
    </div>
  );
}

function getHourOption(minutes: number | null, hour12: boolean): string | null {
  if (minutes === null) return null;
  const hour = Math.floor(minutes / 60);
  if (!hour12) return pad(hour);
  return String(hour % 12 === 0 ? 12 : hour % 12);
}

function toDisplay(input: string, hour12: boolean): string {
  const minutes = parseTime(input);
  return minutes === null ? input : formatTime(minutes, hour12);
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
