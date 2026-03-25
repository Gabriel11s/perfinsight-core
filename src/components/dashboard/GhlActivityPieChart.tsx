const CHART_COLORS = [
  'hsl(199, 89%, 48%)', // blue
  'hsl(263, 70%, 58%)', // purple
  'hsl(38, 92%, 50%)',  // amber
  'hsl(160, 84%, 39%)', // emerald
  'hsl(338, 71%, 53%)', // pink
  'hsl(217, 91%, 60%)', // light blue
  'hsl(24.6, 95%, 53.1%)',// orange
  'hsl(346.8, 77.2%, 49.8%)' // rose
];

interface GhlActivityPieChartProps {
  data: { name: string; count: number }[];
  valueLabel?: string;
}

export function GhlActivityPieChart({ data, valueLabel = 'events' }: GhlActivityPieChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        No data
      </div>
    );
  }

  const MAX_ITEMS = 6;
  const total = data.reduce((acc, curr) => acc + curr.count, 0);

  // Show top items, group the rest as "Other"
  const visible = data.length <= MAX_ITEMS
    ? data
    : [
        ...data.slice(0, MAX_ITEMS),
        { name: 'Other', count: data.slice(MAX_ITEMS).reduce((a, b) => a + b.count, 0) },
      ].filter(d => d.count > 0);

  const maxCount = visible[0]?.count || 1;

  return (
    <div className="space-y-3">
      {/* Header total */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-extrabold tabular-nums tracking-tight font-display">
          {total.toLocaleString()}
        </span>
        <span className="text-xs text-muted-foreground font-medium">{valueLabel}</span>
      </div>

      {/* Bars */}
      <div className="space-y-2.5">
        {visible.map((item, i) => {
          const color = CHART_COLORS[i % CHART_COLORS.length];
          const pct = Math.max(Math.round((item.count / maxCount) * 100), 2);
          const share = total > 0 ? Math.round((item.count / total) * 100) : 0;

          return (
            <div key={item.name} className="group">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors truncate">
                    {item.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-xs text-muted-foreground/60 tabular-nums">{share}%</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground/90 min-w-[3rem] text-right">
                    {item.count.toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
