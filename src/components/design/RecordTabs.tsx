import { useEffect, useId, useRef } from "react";
import { cn } from "../../lib/utils";

export function RecordTabs<T extends string>({
  tabs,
  selected,
  onSelect,
  label,
  children,
}: {
  tabs: readonly { id: T; label: string }[];
  selected: T;
  onSelect: (tab: T) => void;
  label: string;
  children: (tab: T) => React.ReactNode;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const previous = useRef(selected);
  useEffect(() => {
    if (previous.current === selected) return;
    previous.current = selected;
    const button = refs.current[tabs.findIndex((tab) => tab.id === selected)];
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, tabs]);
  return (
    <div className="min-w-0 space-y-4">
      <div
        role="tablist"
        aria-label={label}
        className="sticky top-0 z-20 flex overflow-x-auto rounded-md border border-slate-300 bg-white px-2 shadow-sm"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-${tab.id}`}
            aria-controls={`${id}-panel-${tab.id}`}
            aria-selected={selected === tab.id}
            tabIndex={selected === tab.id ? 0 : -1}
            className={cn(
              "min-h-12 shrink-0 border-b-[3px] px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600",
              selected === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-slate-500 hover:bg-slate-50",
            )}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              onSelect(tabs[next].id);
              refs.current[next]?.focus();
              refs.current[next]?.scrollIntoView({
                block: "nearest",
                inline: "nearest",
              });
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <section
          key={tab.id}
          id={`${id}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab.id}`}
          hidden={selected !== tab.id}
          tabIndex={0}
          className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {children(tab.id)}
        </section>
      ))}
    </div>
  );
}
