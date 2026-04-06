interface ActioningProgressBarProps {
  actioned: number;
  total: number;
  label?: string;
  barColorClass?: string;
  size?: "sm" | "md";
}

export function ActioningProgressBar({
  actioned,
  total,
  label = "TID Actioning Progress",
  barColorClass = "bg-primary",
  size = "md",
}: ActioningProgressBarProps) {
  if (total <= 0) return null;
  const pct = Math.round((actioned / total) * 100);

  if (size === "sm") {
    return (
      <div className="flex items-center gap-1" data-testid={`progress-mini-${label.replace(/\s+/g, "-").toLowerCase()}`}>
        <div className="h-1 w-10 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColorClass}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">{actioned}/{total}</span>
      </div>
    );
  }

  return (
    <div className="mb-3 px-1" data-testid="global-progress-bar">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold" data-testid="global-progress-text">
          {actioned} of {total} TIDs actioned
        </span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColorClass}`}
          style={{ width: `${pct}%` }}
          data-testid="global-progress-fill"
        />
      </div>
    </div>
  );
}
