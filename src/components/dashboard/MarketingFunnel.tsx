import type { MarketingFunnel as FunnelData } from '@/hooks/use-marketing-data';

interface Props {
  data: FunnelData;
}

const stages = [
  { key: 'total_leads', label: 'Leads Criados', color: '#6366f1' },
  { key: 'leads_with_activity', label: 'Atendidos', color: '#8b5cf6' },
  { key: 'leads_with_opportunity', label: 'Com Oportunidade', color: '#a855f7' },
  { key: 'leads_won', label: 'Vendas Fechadas', color: '#10b981' },
] as const;

export function MarketingFunnelChart({ data }: Props) {
  const max = data.total_leads || 1;

  return (
    <div className="space-y-3">
      {stages.map((stage) => {
        const value = data[stage.key] as number;
        const pct = max > 0 ? (value / max) * 100 : 0;
        const convRate = stage.key !== 'total_leads' && data.total_leads > 0
          ? ((value / data.total_leads) * 100).toFixed(1)
          : null;

        return (
          <div key={stage.key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">{stage.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{value}</span>
                {convRate && (
                  <span className="text-muted-foreground">({convRate}%)</span>
                )}
              </div>
            </div>
            <div className="h-6 w-full rounded-md bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded-md transition-all duration-500"
                style={{
                  width: `${Math.max(pct, 2)}%`,
                  background: stage.color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
