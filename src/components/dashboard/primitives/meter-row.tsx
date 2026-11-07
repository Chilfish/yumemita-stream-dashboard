import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";

interface MeterRowProps {
  label: string;
  count: string;
  note?: string;
  value: number;
  max: number;
}

export function MeterRow({ label, count, note, value, max }: MeterRowProps) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 gap-y-1">
      <span className="min-w-0 truncate text-body text-foreground">{label}</span>
      <span className="whitespace-nowrap text-footnote font-medium tabular-nums text-foreground">
        {count}
        {note ? <span className="ml-1 text-caption font-medium text-ink-3">{note}</span> : null}
      </span>
      <Meter
        aria-label={`${label} ${count}`}
        aria-valuetext={count}
        className="col-span-2 gap-0"
        max={Math.max(1, max)}
        min={0}
        value={value}
      >
        <MeterTrack className="h-1.5 rounded-full bg-hairline">
          <MeterIndicator className="rounded-full bg-member" />
        </MeterTrack>
      </Meter>
    </li>
  );
}
