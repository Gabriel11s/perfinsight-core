import type { ChannelSummary } from '@/hooks/use-marketing-data';

interface Props {
  data: ChannelSummary[];
}

const CHANNEL_COLORS: Record<string, string> = {
  facebook: '#1877F2',
  google: '#4285F4',
  instagram: '#E4405F',
  website: '#10b981',
  manual: '#6366f1',
  referral: '#f59e0b',
  api: '#8b5cf6',
};

function getChannelColor(channel: string) {
  const key = channel.toLowerCase().replace(/\s+/g, '');
  return CHANNEL_COLORS[key] || '#64748b';
}

export function ChannelTable({ data }: Props) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Nenhum dado de canal disponível no período selecionado
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Canal</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leads</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atendidos</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Convertidos</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conv. %</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receita</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const convRate = row.lead_count > 0
              ? ((row.converted_count / row.lead_count) * 100).toFixed(1)
              : '0.0';
            const color = getChannelColor(row.channel);

            return (
              <tr key={row.channel} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="font-medium text-foreground capitalize">{row.channel || 'Unknown'}</span>
                  </div>
                </td>
                <td className="text-right py-2.5 px-3 font-semibold text-foreground">{row.lead_count}</td>
                <td className="text-right py-2.5 px-3 text-muted-foreground">{row.attended_count}</td>
                <td className="text-right py-2.5 px-3 text-muted-foreground">{row.converted_count}</td>
                <td className="text-right py-2.5 px-3">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                    Number(convRate) > 20 ? 'bg-emerald-500/10 text-emerald-500' :
                    Number(convRate) > 5 ? 'bg-yellow-500/10 text-yellow-500' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {convRate}%
                  </span>
                </td>
                <td className="text-right py-2.5 px-3 font-semibold text-foreground">
                  {row.revenue > 0 ? `R$ ${row.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
