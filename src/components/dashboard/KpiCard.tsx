import { cn } from '@/lib/utils';
import { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: number;
  icon?: ReactNode;
  accentColor?: string;
  className?: string;
}

export function KpiCard({ title, value, subtitle, trend, icon, accentColor, className }: KpiCardProps) {
  return (
    <div className={cn('metric-card group', className)} style={accentColor ? { borderLeft: `2px solid ${accentColor}` } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <p className="text-[28px] font-extrabold tracking-tight text-foreground leading-none">
            {value}
          </p>
        </div>
        {icon && (
          <div
            className="rounded-xl p-2.5 shrink-0 transition-colors"
            style={{
              background: accentColor
                ? `${accentColor}15`
                : 'hsl(var(--primary) / 0.08)',
              color: accentColor || 'hsl(var(--primary))',
            }}
          >
            {icon}
          </div>
        )}
      </div>

      {(subtitle || trend !== undefined) && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {trend !== undefined && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium',
                trend > 0 && 'bg-emerald-500/10 text-emerald-500',
                trend < 0 && 'bg-red-500/10 text-red-500',
                trend === 0 && 'bg-muted text-muted-foreground',
              )}
            >
              {trend > 0 ? <TrendingUp className="h-3 w-3" /> : trend < 0 ? <TrendingDown className="h-3 w-3" /> : null}
              {trend > 0 ? '+' : ''}{trend}%
            </span>
          )}
          {subtitle && (
            <span className="text-muted-foreground truncate">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}
