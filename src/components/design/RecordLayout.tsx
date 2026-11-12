import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Main + related components; the side area stacks or hides when space is limited. */
export function RecordLayout({
  children,
  aside,
  asideLabel = "Información relacionada",
  compact = false,
  hideAsideOnSmall = false,
}: {
  children: ReactNode;
  aside: ReactNode;
  asideLabel?: string;
  compact?: boolean;
  hideAsideOnSmall?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 items-start gap-4",
        compact
          ? "xl:grid-cols-[minmax(0,1fr)_280px]"
          : "xl:grid-cols-[minmax(0,1fr)_320px]",
      )}
    >
      <div className="min-w-0">{children}</div>
      <aside
        aria-label={asideLabel}
        className={cn(
          "min-w-0 space-y-4",
          hideAsideOnSmall && "hidden xl:block",
        )}
      >
        {aside}
      </aside>
    </div>
  );
}
