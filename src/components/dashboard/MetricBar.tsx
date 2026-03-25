interface MetricItem {
  label: string;
  value: string | number;
  color?: string;
  dotColor?: string;
  pulse?: boolean;
}

interface MetricBarProps {
  items: MetricItem[];
  className?: string;
}

export function MetricBar({ items, className = '' }: MetricBarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/50 backdrop-blur-sm px-3 py-1 text-xs"
        >
          {item.dotColor && (
            <span
              className={`h-1.5 w-1.5 rounded-full ${item.pulse ? 'animate-pulse-soft' : ''}`}
              style={{ background: item.dotColor }}
            />
          )}
          <span className="font-bold tabular-nums" style={item.color ? { color: item.color } : undefined}>
            {item.value}
          </span>
          <span className="text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
