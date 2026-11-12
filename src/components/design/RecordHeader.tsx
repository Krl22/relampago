import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

/** Shared object header: identity, contextual metadata, actions and optional summary. */
export function RecordHeader({
  title,
  subtitle,
  recordType,
  icon: Icon,
  meta,
  actions,
  utility,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  recordType?: string;
  icon: LucideIcon;
  meta?: ReactNode;
  actions?: ReactNode;
  utility?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm",
        className,
      )}
    >
      {utility && (
        <div className="flex justify-end border-b border-slate-200 bg-white px-2">
          {utility}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4 bg-[#f3f3f3] p-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-white">
            <Icon className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            {recordType && (
              <p className="text-xs text-muted-foreground">{recordType}</p>
            )}
            <h1
              id={id}
              className={cn(
                "break-words text-xl font-semibold tracking-tight sm:text-2xl",
                recordType && "mt-1",
              )}
            >
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            )}
            {meta && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {meta}
              </div>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
