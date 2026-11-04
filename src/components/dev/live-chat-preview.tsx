"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VirtualList } from "@/components/dev/virtual-list";
import { formatDuration } from "@/lib/format";
import {
  buildImportedSession,
  chatKindLabel,
  eventTypeLabel,
  inferDatasetId,
  type PreviewData,
  type PreviewEmoji,
  type PreviewEvent,
  type PreviewMessage,
  type PreviewRow,
  type PreviewSession,
} from "@/lib/live-chat-preview";
import { emojiUrl } from "@/lib/media";
import { navigateTo } from "@/lib/router-compat";
import { cn } from "@/lib/utils";

type FilterValue = "all" | "text" | "paid" | "membership" | "event" | "owner";

const JST_TIME = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const JST_DATE = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const EMPTY_ROWS: PreviewRow[] = [];

function formatJst(ts: number): string {
  return JST_TIME.format(new Date(ts * 1000));
}

function formatJstDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : `${JST_DATE.format(date)} JST`;
}

function offsetLabel(ts: number, startedAt: string | null, firstTs: number | null): string | null {
  const start = startedAt ? Date.parse(startedAt) / 1000 : null;
  if (start != null && Number.isFinite(start) && start > 0) {
    const delta = Math.round(ts - start);
    return delta < 0 ? `开播前 ${formatDuration(-delta)}` : `+${formatDuration(delta)}`;
  }
  if (firstTs != null) return `+${formatDuration(ts - firstTs)}`;
  return null;
}

/** YouTube 的 renderer 颜色是 ARGB 整数；转成 CSS rgba。 */
function argbCss(value: number | undefined): string | null {
  if (typeof value !== "number")
    return null;
  const n = value >>> 0;
  const a = (n >>> 24) & 0xff;
  if (a === 0)
    return null;
  const r = (n >>> 16) & 0xff;
  const g = (n >>> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/** 旧档没有 renderer 颜色时按金额给一个近似 SC 等级色。 */
const SC_TIER_COLORS = [
  { max: 100, color: "#1565c0" },
  { max: 500, color: "#00b8d4" },
  { max: 1000, color: "#00bfa5" },
  { max: 2000, color: "#ffb300" },
  { max: 5000, color: "#ff7043" },
  { max: 10000, color: "#e91e63" },
  { max: Number.POSITIVE_INFINITY, color: "#d00000" },
];

function scFallbackColor(amountText: string | null): string | null {
  const amount = Number((amountText ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0)
    return null;
  return SC_TIER_COLORS.find(tier => amount < tier.max)?.color ?? null;
}

interface EmojiMaps {
  byId: Map<string, PreviewEmoji>;
  byName: Map<string, PreviewEmoji>;
}

/** 把索引里的 id → 名称 / 图片地址与抓取时的 InnerTube 地址合并。 */
function buildEmojiMaps(
  assets: PreviewEmoji[],
  names: Map<string, string>,
  datasetId: string | null,
): EmojiMaps {
  const byId = new Map<string, PreviewEmoji>();
  const byName = new Map<string, PreviewEmoji>();
  const register = (asset: PreviewEmoji): void => {
    const name = names.get(asset.id) ?? asset.name;
    const indexUrl = datasetId ? emojiUrl(datasetId, asset.id) : null;
    const next: PreviewEmoji = {
      ...asset,
      name,
      url: indexUrl ?? asset.url,
      fallbackUrl: indexUrl ? asset.url : null,
    };
    byId.set(asset.id, next);
    if (name)
      byName.set(name.toLowerCase(), next);
  };
  for (const asset of assets)
    register(asset);
  for (const [id, name] of names) {
    if (!byId.has(id))
      register({ id, name, url: null });
  }
  return { byId, byName };
}

/**
 * 表情索引走同源 dev 中间件：浏览器直接 fetch 对象存储的 index.json 会被 CORS 挡住。
 */
function usePreviewEmojiIndex(datasetId: string): Map<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    fetch(`/dev/live-chat-emoji-index?dataset=${encodeURIComponent(datasetId)}`, {
      cache: "no-store",
    })
      .then(async response => (response.ok ? await response.json() as { names?: Record<string, string> } : {}))
      .then((payload) => {
        if (active) setNames(payload.names ?? {});
      })
      .catch(() => {
        // 索引失败只影响名称 / 图片，不阻塞消息
      });
    return () => {
      active = false;
    };
  }, [datasetId]);

  return useMemo(() => new Map(Object.entries(names)), [names]);
}

function kindVariant(kind: string): "default" | "outline" | "warning" | "info" | "success" | "secondary" {
  switch (kind) {
    case "superchat":
      return "warning";
    case "sticker":
      return "info";
    case "membership":
      return "success";
    case "gift":
    case "giftRedemption":
      return "secondary";
    default:
      return "outline";
  }
}

function eventVariant(type: string): "default" | "outline" | "warning" | "info" | "success" | "secondary" | "error" {
  switch (type) {
    case "banner":
    case "poll":
    case "pollUpdate":
      return "info";
    case "qna":
    case "product":
      return "success";
    case "deleted":
    case "deletedAuthor":
      return "error";
    case "system":
    case "modeChange":
      return "outline";
    default:
      return "secondary";
  }
}

function searchText(row: PreviewRow): string {
  if (row.kind === "message") {
    return `${row.author} ${row.authorId ?? ""} ${row.chatKind} ${row.text} ${row.sc ?? ""} ${row.badges.join(" ")}`.toLowerCase();
  }
  return `${row.type} ${row.author ?? ""} ${row.authorId ?? ""} ${row.text ?? ""} ${JSON.stringify(row.data ?? {})}`.toLowerCase();
}

function matchesFilter(row: PreviewRow, filter: FilterValue): boolean {
  if (filter === "all") return true;
  if (filter === "owner") return row.owner;
  if (filter === "event") return row.kind === "event";
  if (row.kind === "event") return false;
  if (filter === "text") return row.chatKind === "text";
  if (filter === "paid") return row.chatKind === "superchat" || row.chatKind === "sticker";
  return row.chatKind === "membership" || row.chatKind === "gift" || row.chatKind === "giftRedemption";
}

function PreviewEmojiImage({ emoji }: { emoji: PreviewEmoji }) {
  const [failed, setFailed] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const url = useFallback ? emoji.fallbackUrl : emoji.url;
  if (!url || failed) {
    return (
      <span className="inline-flex items-center text-ink-3" title={emoji.name ?? emoji.id}>
        {emoji.name ?? (emoji.id.includes("/") ? "[表情]" : emoji.id)}
      </span>
    );
  }
  return (
    <img
      alt={emoji.name ?? ""}
      className="mx-0.5 inline-block size-[1.25em] align-[-0.2em]"
      decoding="async"
      loading="lazy"
      onError={() => {
        if (!useFallback && emoji.fallbackUrl) setUseFallback(true);
        else setFailed(true);
      }}
      src={url}
      title={emoji.name ?? undefined}
    />
  );
}

function TextWithEmoji({
  text,
  emojis,
  emojiMaps,
}: {
  text: string;
  emojis: PreviewEmoji[];
  emojiMaps: EmojiMaps;
}) {
  if (!text && emojis.length === 0) return <span className="text-ink-3">（无内容）</span>;
  const parts = text.split(/(:[A-Za-z0-9_]+:)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        const match = /^:([A-Za-z0-9_]+):$/.exec(part);
        const emoji = match ? emojiMaps.byName.get(match[1]!.toLowerCase()) : null;
        if (emoji) return <PreviewEmojiImage emoji={emoji} key={`shortcut-${index}`} />;
        return <span key={`text-${index}`}>{part}</span>;
      })}
      {emojis.map((emoji, index) => (
        <PreviewEmojiImage
          emoji={emojiMaps.byId.get(emoji.id) ?? emoji}
          key={`${emoji.id}-${index}`}
        />
      ))}
    </span>
  );
}

function MessageBody({ row, emojiMaps }: { row: PreviewMessage; emojiMaps: EmojiMaps }) {
  if (row.chatKind === "membership") {
    return (
      <span className="text-ink-3">
        {row.header ?? "（会员事件，无文案）"}
        {row.membershipPrimary ? (
          <span className="ms-1 text-caption">· {row.membershipPrimary}</span>
        ) : null}
      </span>
    );
  }
  if (row.chatKind === "gift") {
    return (
      <span>
        <span className="text-paid">赠送会员 ×{row.giftCount ?? "?"}</span>
        {row.text ? <span className="ms-1 text-muted-foreground">{row.text}</span> : null}
      </span>
    );
  }
  if (row.chatKind === "sticker") {
    if (row.sticker) {
      return (
        <span className="flex items-center gap-2">
          <img
            alt={row.sticker.name ?? ""}
            className="size-16 rounded-md border bg-background object-contain"
            loading="lazy"
            src={row.sticker.url}
          />
          <span className="text-ink-3">{row.sticker.name ?? "[贴纸]"}</span>
        </span>
      );
    }
    return <span className="text-ink-3">[贴纸]{row.sc ? ` ${row.sc}` : ""}</span>;
  }
  return <TextWithEmoji emojiMaps={emojiMaps} emojis={row.emojis} text={row.text} />;
}

function PollChoices({ data }: { data: Record<string, unknown> | null }) {
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  if (choices.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {choices.map((choice, index) => {
        const item = (choice ?? {}) as Record<string, unknown>;
        const text = typeof item.text === "string" ? item.text : "";
        const percent =
          typeof item.percentage === "string"
            ? Number.parseFloat(item.percentage)
            : typeof item.ratio === "number"
              ? item.ratio * 100
              : null;
        const width = percent == null || !Number.isFinite(percent) ? 0 : Math.min(100, Math.max(0, percent));
        return (
          <li
            className="relative overflow-hidden rounded-md border bg-background px-2 py-1"
            key={`${text}-${index}`}
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 bg-primary/12"
              style={{ width: `${width}%` }}
            />
            <span className="relative flex items-center justify-between gap-2 text-footnote">
              <span className="min-w-0 truncate">
                {text}
                {item.selected === true ? " ✓" : ""}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {typeof item.percentage === "string"
                  ? item.percentage
                  : percent != null
                    ? `${percent.toFixed(1)}%`
                    : "—"}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function EventBody({ row }: { row: PreviewEvent }) {
  const data = row.data;
  if (row.type === "poll" || row.type === "pollUpdate") {
    const metadata = typeof data?.metadata === "string" ? data.metadata : null;
    const snapshotCount = typeof data?.snapshotCount === "number" ? data.snapshotCount : 1;
    const updatedAtTs = typeof data?.updatedAtTs === "number" ? data.updatedAtTs : null;
    const meta = [
      metadata,
      snapshotCount > 1 ? `${snapshotCount} 次快照` : null,
      updatedAtTs ? `更新 ${formatJst(updatedAtTs)}` : null,
    ].filter((value): value is string => Boolean(value));
    return (
      <div>
        <PollChoices data={data} />
        {meta.length > 0 ? (
          <p className="mt-1 text-caption text-ink-3">{meta.join(" · ")}</p>
        ) : null}
      </div>
    );
  }
  if (row.type === "deleted" || row.type === "deletedAuthor") {
    const targetAuthor = typeof data?.targetAuthor === "string" ? data.targetAuthor : null;
    const targetText = typeof data?.targetText === "string" ? data.targetText : null;
    const targetId =
      typeof data?.targetItemId === "string"
        ? data.targetItemId
        : typeof data?.authorId === "string"
          ? data.authorId
          : null;
    if (!targetAuthor && !targetText) {
      return (
        <p className="mt-1 text-caption text-ink-3">
          被删消息不在本次抓取范围内{targetId ? ` · ${targetId}` : ""}
        </p>
      );
    }
    return (
      <p className="mt-1 rounded-md border border-dashed px-2 py-1 text-caption text-ink-3">
        被删：{targetAuthor ? `${targetAuthor} · ` : ""}
        {targetText ?? "（正文未收录）"}
      </p>
    );
  }
  if (row.type === "banner") {
    const pinnedAuthor = typeof data?.pinnedAuthor === "string" ? data.pinnedAuthor : null;
    const targetId = typeof data?.targetId === "string" ? data.targetId : null;
    if (!pinnedAuthor && !targetId) return null;
    return (
      <p className="mt-1 text-caption text-ink-3">
        {pinnedAuthor ? `置顶消息作者：${pinnedAuthor}` : "置顶消息"}
        {targetId ? ` · ${targetId}` : ""}
      </p>
    );
  }
  return null;
}

function RawDetails({ row }: { row: PreviewRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        className="cursor-pointer text-caption text-ink-3 underline-offset-2 hover:text-foreground hover:underline"
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        {open ? "收起原始 JSON" : "原始 JSON"}
      </button>
      {open ? (
        <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-muted p-2 text-[11px] leading-relaxed">
          {JSON.stringify(row.raw, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function PreviewRowItem({
  row,
  startedAt,
  firstTs,
  emojiMaps,
}: {
  row: PreviewRow;
  startedAt: string | null;
  firstTs: number | null;
  emojiMaps: EmojiMaps;
}) {
  const offset = offsetLabel(row.ts, startedAt, firstTs);
  const message = row.kind === "message" ? row : null;
  const isSc = message?.chatKind === "superchat";
  const isSticker = message?.chatKind === "sticker";
  const colors = message?.colors ?? null;
  const amountText = message?.sc ?? null;
  const accent = isSc
    ? argbCss(colors?.headerBackground) ?? scFallbackColor(amountText)
    : isSticker
      ? argbCss(colors?.moneyChipBackground) ?? scFallbackColor(amountText)
      : null;
  const background = isSc
    ? argbCss(colors?.bodyBackground)
    : isSticker ? argbCss(colors?.background) : null;
  const textColor = isSc ? argbCss(colors?.bodyText) : null;
  const authorColor = isSc ? argbCss(colors?.authorName) : null;
  const amountBackground = isSc
    ? argbCss(colors?.headerBackground)
    : isSticker ? argbCss(colors?.moneyChipBackground) : null;
  const amountColor = isSc
    ? argbCss(colors?.headerText)
    : isSticker ? argbCss(colors?.moneyChipText) : null;
  const badgeBackground = amountBackground ?? accent;
  const amountStyle = badgeBackground
    ? { backgroundColor: badgeBackground, borderColor: badgeBackground, color: amountColor ?? "#fff" }
    : undefined;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-s-4 border-b border-s-transparent border-hairline px-4 py-3 sm:flex-row sm:gap-3",
        row.kind === "event" && "bg-muted/32",
        row.owner && "bg-primary/4",
      )}
      style={{
        ...(accent ? { borderInlineStartColor: accent } : {}),
        ...(background ? { backgroundColor: background } : {}),
        ...(textColor ? { color: textColor } : {}),
      }}
    >
      <div className="flex shrink-0 items-baseline gap-2 sm:w-32 sm:flex-col sm:gap-0">
        <span className="text-footnote tabular-nums text-muted-foreground">{formatJst(row.ts)}</span>
        {offset ? (
          <span className="text-caption tabular-nums text-ink-3">{offset}</span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {row.kind === "message" ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "text-footnote font-medium",
                  row.owner ? "text-primary" : "text-foreground",
                )}
                style={authorColor ? { color: authorColor } : undefined}
              >
                {row.author}
              </span>
              {row.owner ? (
                <Badge size="sm" variant="default">
                  主播
                </Badge>
              ) : null}
              <Badge size="sm" variant={kindVariant(row.chatKind)}>
                {chatKindLabel(row.chatKind)}
              </Badge>
              {row.memberMessage ? (
                <Badge size="sm" variant="success">
                  会员留言
                </Badge>
              ) : null}
              {row.badges
                .filter(badge => badge !== "Owner")
                .map((badge, index) => (
                  <Badge key={`${badge}-${index}`} size="sm" variant="secondary">
                    {badge}
                  </Badge>
                ))}
              {row.sc ? (
                <Badge size="sm" style={amountStyle} variant="warning">
                  {row.sc}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 text-footnote leading-relaxed text-foreground">
              <MessageBody emojiMaps={emojiMaps} row={row} />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge size="sm" variant={eventVariant(row.type)}>
                {eventTypeLabel(row.type)}
              </Badge>
              {row.owner ? (
                <Badge size="sm" variant="default">
                  主播
                </Badge>
              ) : null}
              {row.author ? (
                <span className="text-footnote text-muted-foreground">{row.author}</span>
              ) : null}
            </div>
            <div className="mt-1 text-footnote leading-relaxed text-foreground">
              {row.text
                ? <TextWithEmoji emojiMaps={emojiMaps} emojis={[]} text={row.text} />
                : <span className="text-ink-3">（无文本）</span>}
            </div>
            <EventBody row={row} />
          </>
        )}

        <RawDetails row={row} />
      </div>
    </div>
  );
}

function StatCard({ hint, label, value }: { hint?: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <div className="text-caption text-muted-foreground">{label}</div>
      <div className="text-stat-sm font-semibold tabular-nums text-foreground">{value}</div>
      {hint ? <div className="text-caption text-ink-3">{hint}</div> : null}
    </div>
  );
}

export function LiveChatPreview({ data }: { data: PreviewData }) {
  const [imported, setImported] = useState<PreviewSession | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const session = imported ?? data.session;
  const rows = session?.rows ?? EMPTY_ROWS;
  const counts = session?.counts;
  const datasetId = inferDatasetId(session);
  const indexDataset = datasetId ?? "yuno";
  const emojiNames = usePreviewEmojiIndex(indexDataset);
  const emojiMaps = useMemo(
    () => buildEmojiMaps(session?.emojiAssets ?? [], emojiNames, indexDataset),
    [emojiNames, indexDataset, session],
  );

  const filterOptions = useMemo(() => {
    if (!counts) return [];
    return [
      { count: counts.messages + counts.events, label: "全部", value: "all" as const },
      { count: counts.byKind.text ?? 0, label: "文字", value: "text" as const },
      {
        count: (counts.byKind.superchat ?? 0) + (counts.byKind.sticker ?? 0),
        label: "付费",
        value: "paid" as const,
      },
      {
        count:
          (counts.byKind.membership ?? 0) +
          (counts.byKind.gift ?? 0) +
          (counts.byKind.giftRedemption ?? 0),
        label: "会员",
        value: "membership" as const,
      },
      { count: counts.events, label: "事件", value: "event" as const },
      {
        count: counts.ownerMessages + counts.ownerEvents,
        label: "主播",
        value: "owner" as const,
      },
    ];
  }, [counts]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      row => matchesFilter(row, filter) && (!needle || searchText(row).includes(needle)),
    );
  }, [filter, query, rows]);

  function selectSession(id: string): void {
    setImported(null);
    setImportError(null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("session", id);
    else url.searchParams.delete("session");
    void navigateTo(`${url.pathname}${url.search}`);
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setImportError(null);
    try {
      setImported(buildImportedSession(file.name, await file.text()));
    }
    catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">DEV</Badge>
            <h1 className="text-headline text-foreground">直播弹幕与事件预览</h1>
          </div>
          <p className="max-w-3xl text-caption text-ink-3">
            直接读 <code className="rounded bg-muted px-1">{data.root}</code>{" "}
            下的实时采集文件；仅开发环境可用，不进入正式页面与索引。也可以导入本地 jsonl。
          </p>
        </header>

        {data.error ? (
          <div className="rounded-2xl border border-destructive/32 bg-destructive/4 px-4 py-6">
            <h2 className="text-headline text-foreground">读不到会话</h2>
            <p className="mt-1 text-footnote text-muted-foreground">{data.error}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card px-4 py-3">
          <label className="flex min-w-60 flex-1 flex-col gap-1" htmlFor="session-select">
            <span className="text-caption text-muted-foreground">会话</span>
            <select
              className="h-8.5 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24"
              id="session-select"
              onChange={(event) => {
                if (imported && event.target.value === imported.id) return;
                selectSession(event.target.value);
              }}
              value={session?.id ?? ""}
            >
              {data.sessions.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label ?? "?"} · {item.videoId} · {item.id}
                </option>
              ))}
              {imported ? <option value={imported.id}>{imported.id}（导入）</option> : null}
            </select>
          </label>
          <Button onClick={() => selectSession("")} size="sm" variant="outline">
            最新
          </Button>
          <Button onClick={() => window.location.reload()} size="sm" variant="outline">
            刷新
          </Button>
          <input
            accept=".jsonl,.json,.txt"
            className="hidden"
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline">
            导入 JSONL
          </Button>
          {session ? (
            <Button
              render={
                <a
                  href={`https://www.youtube.com/watch?v=${session.videoId}`}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              size="sm"
              variant="outline"
            >
              YouTube
            </Button>
          ) : null}
        </div>

        {importError ? (
          <p className="rounded-xl border border-destructive/32 bg-destructive/4 px-3 py-2 text-footnote text-destructive">
            导入失败：{importError}
          </p>
        ) : null}

        {imported ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/32 px-3 py-2 text-footnote">
            <Badge variant="info">导入</Badge>
            <span className="min-w-0 truncate">{imported.id}</span>
            <Button onClick={() => setImported(null)} size="xs" variant="outline">
              返回会话
            </Button>
          </div>
        ) : null}

        {session && counts ? (
          <>
            <section className="rounded-2xl border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-stat-sm font-semibold text-foreground">
                  {session.title ?? session.id}
                </h2>
                <Badge variant="outline">{session.videoId}</Badge>
                {session.datasetId ? <Badge variant="secondary">{session.datasetId}</Badge> : null}
                {session.status?.isLiveNow === true ? (
                  <Badge variant="success">直播中</Badge>
                ) : (
                  <Badge variant="outline">{String(session.status?.playability ?? "未知")}</Badge>
                )}
                {session.invalid > 0 ? (
                  <Badge variant="error">坏行 {session.invalid}</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-footnote text-muted-foreground">
                预定开播 {formatJstDate(session.startedAt)} · 更新{" "}
                {formatJstDate(session.updatedAt)} · 会话 {session.id}
              </p>
              <p className="mt-0.5 break-all text-caption text-ink-3">{session.dir}</p>
            </section>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              <StatCard label="消息" value={String(counts.messages)} />
              <StatCard label="事件" value={String(counts.events)} />
              <StatCard label="作者" value={String(counts.uniqueAuthors)} />
              <StatCard
                hint={`${counts.ownerMessages} 发言 / ${counts.ownerEvents} 操作`}
                label="主播"
                value={String(counts.ownerMessages + counts.ownerEvents)}
              />
              <StatCard label="表情" value={String(counts.emojiDistinct)} />
              <StatCard
                label="时间跨度"
                value={counts.spanSec != null ? formatDuration(counts.spanSec) : "—"}
              />
              <StatCard
                label="首条"
                value={counts.firstTs != null ? formatJst(counts.firstTs) : "—"}
              />
              <StatCard
                label="末条"
                value={counts.lastTs != null ? formatJst(counts.lastTs) : "—"}
              />
            </dl>

            <div className="flex flex-wrap gap-1.5">
              {Object.entries(counts.byKind)
                .sort((a, b) => b[1] - a[1])
                .map(([kind, count]) => (
                  <Badge key={kind} variant={kindVariant(kind)}>
                    {chatKindLabel(kind)} {count}
                  </Badge>
                ))}
              {Object.entries(counts.byEvent)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <Badge key={type} variant={eventVariant(type)}>
                    {eventTypeLabel(type)} {count}
                  </Badge>
                ))}
            </div>

            <div className="sticky top-0 z-10 -mx-4 border-y bg-background/92 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {filterOptions.map(option => (
                    <Button
                      aria-pressed={filter === option.value}
                      key={option.value}
                      onClick={() => setFilter(option.value)}
                      size="xs"
                      variant={filter === option.value ? "default" : "outline"}
                    >
                      {option.label}
                      <span className="text-caption opacity-70 tabular-nums">{option.count}</span>
                    </Button>
                  ))}
                  <span className="ms-auto text-caption tabular-nums text-ink-3">
                    {filtered.length} / {rows.length} 条
                  </span>
                </div>
                <Input
                  onChange={event => setQuery(event.target.value)}
                  placeholder="搜索作者、正文、事件类型、投票选项…"
                  type="search"
                  value={query}
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="py-12 text-center text-footnote text-ink-3">没有匹配的记录</p>
            ) : (
              <VirtualList
                className="h-[70dvh]"
                estimateHeight={96}
                getKey={(row, index) =>
                  row.kind === "message"
                    ? (row.rendererId ?? `${row.ts}-${index}`)
                    : `${row.type}-${row.ts}-${index}`}
                items={filtered}
                key={`${session.id}-${filter}-${query}`}
                renderItem={(row) => (
                  <PreviewRowItem
                    emojiMaps={emojiMaps}
                    firstTs={counts.firstTs}
                    row={row}
                    startedAt={session.startedAt}
                  />
                )}
              />
            )}
          </>
        ) : null}

        {!session && !data.error ? (
          <p className="py-12 text-center text-footnote text-ink-3">
            没有找到包含弹幕的会话。先运行{" "}
            <code className="rounded bg-muted px-1">bun run fetch:live-chat --video &lt;id&gt;</code>。
          </p>
        ) : null}
      </div>
    </div>
  );
}
