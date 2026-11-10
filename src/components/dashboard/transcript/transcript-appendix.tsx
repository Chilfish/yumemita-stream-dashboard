import { ChevronDown } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import {
  type SubtitleAppendix,
  type SubtitleCue,
  type SubtitleMode,
  type SubtitleSection,
} from "@/lib/transcripts";
import { cn } from "@/lib/utils";

const MODE_OPTIONS: { value: SubtitleMode; label: string }[] = [
  { value: "bilingual", label: "双语" },
  { value: "zh", label: "中文" },
  { value: "jp", label: "日文" },
];

const EMPTY_KEYS: ReadonlySet<string> = new Set();

/** 附录字幕的全局语言开关；只渲染中文时正文大约少一半。 */
function SubtitleModeControl({
  mode,
  onChange,
}: {
  mode: SubtitleMode;
  onChange: (mode: SubtitleMode) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-caption text-ink-3">附录字幕</span>
      <SegmentedControl aria-label="附录字幕语言" size="sm">
        {MODE_OPTIONS.map(option => (
          <SegmentedControlItem
            aria-current={mode === option.value ? "page" : undefined}
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  );
}

/** 附录正文只用固定格式里的粗体与行内代码，不值得为每条字幕再建一套 Markdown 解析。 */
function InlineText({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <strong className="font-semibold text-foreground" key={index}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code
              className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
              key={index}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

function SubtitleCueView({
  cue,
  mode,
  revealed,
  onToggle,
}: {
  cue: SubtitleCue;
  mode: SubtitleMode;
  revealed: boolean;
  onToggle: () => void;
}) {
  const showJapanese = mode !== "zh" || revealed;
  const showChinese = mode !== "jp" || revealed;

  return (
    <div>
      <p className="my-1 flex flex-wrap items-baseline gap-x-2 text-body font-semibold text-foreground">
        <span className="text-caption font-medium text-ink-3 tabular-nums">
          （{cue.marker}）{cue.time ? ` ${cue.time}` : ""}
        </span>
        <span>
          <InlineText text={cue.title} />
        </span>
        {mode === "bilingual" ? null : (
          <Button
            aria-label={mode === "jp" ? "显示这条的中文译文" : "显示这条的日语原文"}
            aria-pressed={revealed}
            className={cn("text-caption", revealed ? "text-member-ink" : "text-ink-3")}
            onClick={onToggle}
            size="xs"
            title={mode === "jp" ? "显示中文译文" : "显示日语原文"}
            variant="ghost"
          >
            {mode === "jp" ? "译文" : "原文"}
          </Button>
        )}
      </p>

      {showJapanese && cue.japanese ? (
        <blockquote className="my-4 border-s-2 border-member-ink/50 bg-muted/30 py-1.5 ps-4 text-muted-foreground">
          <InlineText text={cue.japanese} />
        </blockquote>
      ) : null}

      {showChinese && cue.chinese ? (
        <p className="my-2">
          <InlineText text={cue.chinese} />
        </p>
      ) : null}
    </div>
  );
}

function SubtitleSectionView({
  id,
  mode,
  section,
  sectionIndex,
  revealed,
  onToggle,
}: {
  id: string | undefined;
  mode: SubtitleMode;
  section: SubtitleSection;
  sectionIndex: number;
  revealed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <section className="mt-8 first:mt-6">
      <h3 className="mt-6 mb-2 scroll-mt-20 text-headline text-foreground" id={id}>
        <InlineText text={section.heading} />
      </h3>
      <div className="flex flex-col">
        {section.cues.map((cue, cueIndex) => {
          const key = `${sectionIndex}-${cueIndex}`;
          return (
            <SubtitleCueView
              cue={cue}
              key={key}
              mode={mode}
              onToggle={() => onToggle(key)}
              revealed={revealed.has(key)}
            />
          );
        })}
      </div>
    </section>
  );
}

export interface TranscriptAppendixViewProps {
  appendix: SubtitleAppendix;
  /** 与 `appendix.sections` 一一对应的标题锚点 id。 */
  ids: (string | undefined)[];
  mode: SubtitleMode;
  open: boolean;
  onModeChange: (mode: SubtitleMode) => void;
  onOpenChange: (open: boolean) => void;
}

export function TranscriptAppendixView({
  appendix,
  ids,
  mode,
  open,
  onModeChange,
  onOpenChange,
}: TranscriptAppendixViewProps) {
  // 逐条展开的状态只在当前模式内有效：切到双语 / 另一种语言后自动作废。
  const [revealed, setRevealed] = useState<{
    mode: SubtitleMode;
    keys: Set<string>;
  }>({ mode, keys: new Set() });
  const activeKeys = revealed.mode === mode ? revealed.keys : EMPTY_KEYS;

  function toggle(key: string): void {
    setRevealed(previous => {
      const keys = new Set(previous.mode === mode ? previous.keys : []);
      if (keys.has(key)) keys.delete(key);
      else keys.add(key);
      return { mode, keys };
    });
  }

  const cueCount = appendix.sections.reduce((total, section) => total + section.cues.length, 0);

  return (
    <Collapsible
      className="mt-6 border-t border-hairline pt-3"
      onOpenChange={(next: boolean) => onOpenChange(next)}
      open={open}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-footnote font-medium text-foreground outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink data-panel-open:*:data-[slot=appendix-chevron]:rotate-180">
          {open ? "收起字幕" : `展开字幕（${cueCount} 条）`}
          <ChevronDown
            aria-hidden="true"
            className="size-4 text-ink-3 transition-transform duration-200"
            data-slot="appendix-chevron"
          />
        </CollapsibleTrigger>
        {open ? <SubtitleModeControl mode={mode} onChange={onModeChange} /> : null}
      </div>
      <CollapsiblePanel className="pt-4">
        {appendix.sections.map((section, sectionIndex) => (
          <SubtitleSectionView
            id={ids[sectionIndex]}
            key={`${sectionIndex}-${section.heading}`}
            mode={mode}
            onToggle={toggle}
            revealed={activeKeys}
            section={section}
            sectionIndex={sectionIndex}
          />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  );
}
