import { CalendarPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  emptyForm,
  jstTime,
  type DatasetOption,
  type FormState,
} from "@/components/admin/schedule-form-state";
import { ScheduleForm } from "@/components/admin/schedule-form";
import { ScheduleList } from "@/components/admin/schedule-list";
import { PageHeader } from "@/components/dashboard/primitives/page-header";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ToastProvider, toastManager } from "@/components/ui/toast";
import { addDays } from "@/lib/calendar";
import type { AdminScheduleItem } from "@/types/calendar";

interface ScheduleEditorProps {
  datasets: DatasetOption[];
  initialItems: AdminScheduleItem[];
  today: string;
}

export function ScheduleEditor(props: ScheduleEditorProps) {
  return (
    <ToastProvider position="bottom-right">
      <Editor {...props} />
    </ToastProvider>
  );
}

interface EditingTarget {
  datasetId: string;
  eventKey: string;
}

function Editor({ datasets, initialItems, today }: ScheduleEditorProps) {
  const [items, setItems] = useState(initialItems);
  const [form, setForm] = useState<FormState>(() => emptyForm(datasets, today));
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminScheduleItem | null>(null);

  function patchForm(patch: Partial<FormState>): void {
    setForm(current => ({ ...current, ...patch }));
  }

  function resetForm(): void {
    setForm(emptyForm(datasets, today));
    setEditing(null);
    setError(null);
  }

  async function refresh(): Promise<void> {
    const response = await fetch(
      `/api/admin/schedule?from=${addDays(today, -7)}&to=${addDays(today, 60)}`,
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) return;
    const body = await response.json() as { items?: AdminScheduleItem[] };
    if (body.items) setItems(body.items);
  }

  function startEdit(item: AdminScheduleItem): void {
    if (item.source !== "manual") {
      toastManager.add({
        type: "info",
        title: "自动同步的日程",
        description: "这里只编辑手工日程。自动行会在下一次同步时刷新。",
      });
      return;
    }

    setEditing({ datasetId: item.datasetId, eventKey: item.eventKey });
    setForm({
      datasetId: item.datasetId,
      title: item.title,
      date: item.date ?? today,
      timeMode: item.timeTentative ? "slot" : "time",
      slot: item.slot ?? "late",
      time: jstTime(item.scheduledAt),
      kind: item.kind ?? "none",
      expectedMinutes: item.expectedMinutes ? String(item.expectedMinutes) : "",
      availability: item.availability === "subscriber_only" ? "subscriber_only" : "public",
      note: item.note ?? "",
      url: item.url ?? "",
      cancelled: item.cancelled,
    });
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (form.timeMode === "time" && !form.time) {
      setError("请填写精确时间，或切换到时段模式");
      return;
    }
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {
      datasetId: form.datasetId,
      title: form.title.trim(),
      date: form.date,
      kind: form.kind === "none" ? null : form.kind,
      expectedMinutes: form.expectedMinutes ? Number(form.expectedMinutes) : null,
      availability: form.availability,
      note: form.note.trim() || null,
      url: form.url.trim() || null,
      cancelled: form.cancelled,
    };
    if (form.timeMode === "time") payload.scheduledAt = `${form.date}T${form.time}:00+09:00`;
    else payload.slot = form.slot;

    if (editing) {
      payload.datasetId = editing.datasetId;
      payload.eventKey = editing.eventKey;
    }

    try {
      const response = await fetch("/api/admin/schedule", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { ok: boolean; error?: string };

      if (response.status === 401) {
        setError("登录已失效，刷新页面重新登录。");
        return;
      }
      if (!response.ok || !body.ok) {
        setError(body.error ?? "保存失败");
        return;
      }

      toastManager.add({
        type: "success",
        title: editing ? "已更新日程" : "已添加日程",
        description: payload.title as string,
      });
      resetForm();
      await refresh();
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    const response = await fetch(
      `/api/admin/schedule?datasetId=${encodeURIComponent(target.datasetId)}&eventKey=${encodeURIComponent(target.eventKey)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      toastManager.add({
        type: "error",
        title: "删除失败",
        description: body?.error ?? "请稍后重试",
      });
      return;
    }

    toastManager.add({ type: "success", title: "已删除日程" });
    if (editing?.datasetId === target.datasetId && editing.eventKey === target.eventKey) {
      resetForm();
    }
    await refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 md:px-6">
      <PageHeader
        actions={(
          <Button onClick={resetForm} size="sm" variant="outline">
            <CalendarPlus aria-hidden="true" />
            新日程
          </Button>
        )}
        facts={[
          { label: "本地日程", value: items.filter(item => !item.cancelled).length },
          { label: "已取消", value: items.filter(item => item.cancelled).length },
        ]}
        title="日程维护"
      >
        只在这里维护手工日程；真实场次开播后由每日任务写入，日历读取时自动关联。
      </PageHeader>

      <ScheduleForm
        datasets={datasets}
        editingKey={editing?.eventKey ?? null}
        error={error}
        form={form}
        onChange={patchForm}
        onReset={resetForm}
        onSubmit={submit}
        saving={saving}
      />

      <ScheduleList
        datasets={datasets}
        items={items}
        onDelete={setDeleteTarget}
        onEdit={startEdit}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条日程？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title || "待定"} · {deleteTarget?.date ?? "日期待定"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose>
            <Button onClick={remove} variant="destructive">删除</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
