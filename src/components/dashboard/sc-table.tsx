import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StreamRow } from "@/lib/aggregate";
import { currencyLabel, formatCurrency, formatTime } from "@/lib/format";

interface ScTableProps {
  row: StreamRow;
}

export function ScTable({ row }: ScTableProps) {
  const superchats = [...row.pack.chat.paid.superchats].sort((a, b) =>
    b.at.localeCompare(a.at),
  );

  if (superchats.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-muted-foreground text-sm">
        本场没有 SC
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {row.pack.chat.paid.scTotalsByCurrency
          ? Object.entries(row.pack.chat.paid.scTotalsByCurrency).map(([currency, total]) => (
              <Badge key={currency} variant="secondary">
                {currencyLabel(currency)} · {total.count} 笔 · {formatCurrency(currency, total.amount)}
              </Badge>
            ))
          : null}
      </div>
      <ScrollArea className="h-[420px] rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">时刻</TableHead>
              <TableHead className="w-24">金额</TableHead>
              <TableHead className="w-36">发送者</TableHead>
              <TableHead>内容</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {superchats.map((superchat, index) => (
              <TableRow key={`${superchat.at}-${superchat.author}-${index}`}>
                <TableCell className="font-mono text-xs">{formatTime(superchat.at)}</TableCell>
                <TableCell className="font-mono text-xs">{superchat.amountText}</TableCell>
                <TableCell className="max-w-36 truncate text-xs">{superchat.author}</TableCell>
                <TableCell className="max-w-[520px] whitespace-normal text-xs leading-relaxed">
                  {superchat.message || <span className="text-muted-foreground">（无留言）</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
