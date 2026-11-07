import type { ContentTypeKey } from "@/lib/classify";
import { jstHour } from "@/lib/schedule";
import type { ScheduleSlot } from "@/types/calendar";

export interface DatasetOption {
  id: string;
  label: string;
  color: string | null;
}

export interface FormState {
  datasetId: string;
  title: string;
  date: string;
  timeMode: "slot" | "time";
  slot: ScheduleSlot;
  time: string;
  kind: ContentTypeKey | "none";
  expectedMinutes: string;
  availability: "public" | "subscriber_only";
  note: string;
  url: string;
  cancelled: boolean;
}

const jstMinuteFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  minute: "2-digit",
});

export function emptyForm(datasets: DatasetOption[], today: string): FormState {
  return {
    datasetId: datasets[0]?.id ?? "",
    title: "",
    date: today,
    timeMode: "slot",
    slot: "late",
    time: "20:00",
    kind: "none",
    expectedMinutes: "",
    availability: "public",
    note: "",
    url: "",
    cancelled: false,
  };
}

/** 把带时区的 ISO 时刻转成 JST 的 `HH:mm`，用于回填表单。 */
export function jstTime(iso: string | null): string {
  if (!iso) return "20:00";
  const hour = jstHour(iso) ?? 20;
  const minute = jstMinuteFormat.format(new Date(iso));
  return `${String(hour).padStart(2, "0")}:${minute}`;
}
