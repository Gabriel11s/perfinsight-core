import type { AgentPerformance } from '@/hooks/use-marketing-data';

interface Props {
  data: AgentPerformance[];
  userNames: Map<string, string>;
}

export function AgentPerformanceTable({ data, userNames }: Props) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Nenhum dado de agente disponível no período selecionado
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">#</th>
            <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agente</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leads</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atendidos</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Convertidos</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conv. %</th>
            <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receita</th>
          </tr>
        </thead>
        <tbody>
          {data.map((agent, i) => {
            const convRate = agent.leads_assigned > 0
              ? ((agent.leads_converted / agent.leads_assigned) * 100).toFixed(1)
              : '0.0';
            const name = userNames.get(agent.user_id) || agent.user_id;
            const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

            return (
              <tr key={agent.user_id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                <td className="py-2.5 px-3 text-muted-foreground font-mono text-xs">{i + 1}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                      {initials}
                    </div>
                    <span className="font-medium text-foreground truncate max-w-[180px]">{name}</span>
                  </div>
                </td>
                <td className="text-right py-2.5 px-3 font-semibold text-foreground">{agent.leads_assigned}</td>
                <td className="text-right py-2.5 px-3 text-muted-foreground">{agent.leads_attended}</td>
                <td className="text-right py-2.5 px-3 text-muted-foreground">{agent.leads_converted}</td>
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
                  {agent.revenue > 0 ? `R$ ${agent.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
