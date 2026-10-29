import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  align?: "left" | "right";
  width?: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  rowHref?: (row: T) => string;
  rowLabel?: (row: T) => string;
  empty?: ReactNode;
  stickyHeader?: boolean;
  stickyFirstColumn?: boolean;
  className?: string;
  ariaLabel?: string;
}

type SortDir = "asc" | "desc";

function ariaSort(active: boolean, dir?: SortDir): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  rowHref,
  rowLabel,
  empty,
  stickyHeader,
  stickyFirstColumn,
  className,
  ariaLabel,
}: DataTableProps<T>) {
  return (
    <Table aria-label={ariaLabel} className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((column, columnIndex) => {
            const active = sort?.key === column.key;
            const sortable = onSort !== undefined && column.sortable === true;

            return (
              <TableHead
                aria-sort={sortable ? ariaSort(active, sort?.dir) : undefined}
                className={cn(
                  "group text-footnote",
                  stickyHeader && "sticky top-14 z-10 bg-card",
                  stickyFirstColumn &&
                    columnIndex === 0 &&
                    "sticky left-0 z-20 border-e border-hairline bg-card",
                  column.align === "right" && "text-right",
                  column.headerClassName,
                )}
                key={column.key}
                style={column.width ? { width: column.width } : undefined}
              >
                {sortable && onSort ? (
                  <button
                    className={cn(
                      "inline-flex items-center gap-1 rounded-control transition-colors duration-120 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink",
                      column.align === "right" && "flex-row-reverse",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                    onClick={() => onSort(column.key)}
                    type="button"
                  >
                    {column.header}
                    <SortIcon active={active} dir={sort?.dir} />
                  </button>
                ) : (
                  column.header
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody className="divide-y divide-hairline">
        {rows.length === 0 ? (
          <TableRow className="border-b-0">
            <TableCell
              className="py-6 text-center text-footnote text-muted-foreground"
              colSpan={columns.length}
            >
              {empty ?? "暂无数据"}
            </TableCell>
          </TableRow>
        ) : (
          rows.map(row => {
            const href = rowHref?.(row);

            return (
              <TableRow className="h-11 border-b-0 md:h-[2.0625rem]" key={rowKey(row)}>
                {columns.map((column, columnIndex) => (
                  <TableCell
                    className={cn(
                      "py-2 text-footnote",
                      stickyFirstColumn &&
                        columnIndex === 0 &&
                        "sticky left-0 z-10 border-e border-hairline bg-card",
                      column.align === "right" && "text-right tabular-nums",
                      column.cellClassName,
                    )}
                    key={column.key}
                  >
                    {column.render(row)}
                  </TableCell>
                ))}
                {href ? (
                  <TableCell className="w-0 p-0">
                    <Link
                      aria-label={rowLabel?.(row) ?? "打开详情"}
                      className="absolute inset-0 z-20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-member-ink"
                      to={href}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir?: SortDir }) {
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3 shrink-0 transition-opacity duration-120",
        active ? "opacity-100" : "opacity-0 group-hover:opacity-40 group-focus-within:opacity-40",
      )}
    />
  );
}
