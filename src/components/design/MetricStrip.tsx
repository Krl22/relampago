import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type SummaryMetric = {
  label: string;
  value: ReactNode;
  description?: string;
  valueClassName?: string;
};
/** Compact facts belong to the record header; values keep their labels and reading order. */
export function MetricStrip({
  items,
  columns = 4,
}: {
  items: readonly SummaryMetric[];
  columns?: 4 | 5;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 border-t border-slate-200",
        columns === 5 ? "sm:grid-cols-3 xl:grid-cols-5" : "sm:grid-cols-4",
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 border-b border-r border-slate-200 px-4 py-4 last:border-r-0 sm:px-5"
        >
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd
            className={cn(
              "mt-1 break-words text-xl font-semibold tabular-nums text-slate-900 sm:text-2xl",
              item.valueClassName,
            )}
          >
            {item.value}
          </dd>
          {item.description && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {item.description}
            </p>
          )}
        </div>
      ))}
    </dl>
  );
}
