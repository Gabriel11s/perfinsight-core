import { Users, TrendingUp, DollarSign, UserCheck, Megaphone, Loader2, Target, PiggyBank } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { ChannelTable } from '@/components/dashboard/ChannelTable';
import { AgentPerformanceTable } from '@/components/dashboard/AgentPerformanceTable';
import { MarketingFunnelChart } from '@/components/dashboard/MarketingFunnel';
import {
  useMarketingChannels,
  useMarketingAgents,
  useMarketingFunnel,
  useMarketingTimeline,
} from '@/hooks/use-marketing-data';
import { useGhlUserNames } from '@/hooks/use-tracker-data';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { formatInTimeZone } from 'date-fns-tz';
import { useFilters } from '@/hooks/use-filters';
import { parseISO } from 'date-fns';
import { useMarketingRoi, type RoiRow } from '@/hooks/use-ad-spend';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const CHANNEL_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#3b82f6', '#ef4444', '#14b8a6', '#f97316', '#64748b',
];

export default function Marketing() {
  const { timezone } = useFilters();
  const { data: channels, isLoading: loadingChannels } = useMarketingChannels();
  const { data: agents, isLoading: loadingAgents } = useMarketingAgents();
  const { data: funnel, isLoading: loadingFunnel } = useMarketingFunnel();
  const { data: timeline, isLoading: loadingTimeline } = useMarketingTimeline();
  const { data: userNameMap } = useGhlUserNames();
  const { data: roiData } = useMarketingRoi();

  const isLoading = loadingChannels || loadingAgents || loadingFunnel || loadingTimeline;

  // ROI summary totals
  const totalSpend = roiData?.reduce((s, r) => s + Number(r.spend), 0) ?? 0;
  const totalRevenue = funnel?.total_revenue ?? 0;
  const overallRoi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend * 100).toFixed(1) : null;
  const overallCpl = (funnel?.total_leads ?? 0) > 0 && totalSpend > 0
    ? (totalSpend / (funnel?.total_leads ?? 1)).toFixed(2) : null;

  // Build timeline chart data: pivot channels into columns per day
  const timelineChartData = (() => {
    if (!timeline?.length) return [];
    const dayMap = new Map<string, Record<string, number>>();
    const allChannels = new Set<string>();

    for (const row of timeline) {
      allChannels.add(row.channel);
      const existing = dayMap.get(row.day) ?? {};
      existing[row.channel] = (existing[row.channel] ?? 0) + row.count;
      dayMap.set(row.day, existing);
    }

    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, channelCounts]) => ({
        day: formatInTimeZone(parseISO(`${day}T12:00:00Z`), timezone, 'dd/MM'),
        ...channelCounts,
      }));
  })();

  const uniqueChannels = timeline
    ? [...new Set(timeline.map(r => r.channel))].slice(0, 10)
    : [];

  const convRate = funnel && funnel.total_leads > 0
    ? ((funnel.leads_won / funnel.total_leads) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5">
          <Megaphone className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Marketing</h1>
          <p className="text-xs text-muted-foreground">Canais, conversões e desempenho dos agentes</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {!isLoading && (
        <>
          {/* Row 1 — Funnel KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              title="Total Leads"
              value={String(funnel?.total_leads ?? 0)}
              icon={<Users className="h-4 w-4" />}
              accentColor="#6366f1"
            />
            <KpiCard
              title="Atendidos"
              value={String(funnel?.leads_with_activity ?? 0)}
              subtitle={funnel && funnel.total_leads > 0
                ? `${((funnel.leads_with_activity / funnel.total_leads) * 100).toFixed(0)}% dos leads`
                : undefined}
              icon={<UserCheck className="h-4 w-4" />}
              accentColor="#8b5cf6"
            />
            <KpiCard
              title="Convertidos"
              value={String(funnel?.leads_won ?? 0)}
              subtitle={`${convRate}% taxa de conversão`}
              icon={<TrendingUp className="h-4 w-4" />}
              accentColor="#10b981"
            />
            <KpiCard
              title="Receita"
              value={funnel && funnel.total_revenue > 0
                ? `R$ ${funnel.total_revenue.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`
                : 'R$ 0'}
              icon={<DollarSign className="h-4 w-4" />}
              accentColor="#f59e0b"
            />
          </div>

          {/* Row 2 — ROI Metrics (only if ad_spend exists) */}
          {roiData && roiData.some(r => Number(r.spend) > 0) && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard
                  title="Investimento Total"
                  value={`R$ ${totalSpend.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`}
                  icon={<PiggyBank className="h-4 w-4" />}
                  accentColor="#ef4444"
                />
                <KpiCard
                  title="CPL (Custo/Lead)"
                  value={overallCpl ? `R$ ${Number(overallCpl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                  icon={<Target className="h-4 w-4" />}
                  accentColor="#f97316"
                />
                <KpiCard
                  title="ROI"
                  value={overallRoi ? `${overallRoi}%` : '—'}
                  subtitle={Number(overallRoi ?? 0) > 0 ? 'Positivo' : Number(overallRoi ?? 0) < 0 ? 'Negativo' : undefined}
                  icon={<TrendingUp className="h-4 w-4" />}
                  accentColor={Number(overallRoi ?? 0) >= 0 ? '#10b981' : '#ef4444'}
                />
                <KpiCard
                  title="Receita vs Invest."
                  value={totalSpend > 0 ? `${(totalRevenue / totalSpend).toFixed(1)}x` : '—'}
                  subtitle="ROAS"
                  icon={<DollarSign className="h-4 w-4" />}
                  accentColor="#6366f1"
                />
              </div>

              <div className="metric-card">
                <h2 className="text-sm font-semibold text-foreground mb-3">ROI por Canal</h2>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Canal</TableHead>
                        <TableHead className="text-right">Investimento</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">CPL</TableHead>
                        <TableHead className="text-right">Vendas</TableHead>
                        <TableHead className="text-right">CPA</TableHead>
                        <TableHead className="text-right">Receita</TableHead>
                        <TableHead className="text-right">ROI</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roiData.filter(r => Number(r.spend) > 0 || Number(r.lead_count) > 0).map((row) => (
                        <TableRow key={row.channel}>
                          <TableCell className="font-medium">{row.channel}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            R$ {Number(row.spend).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{row.lead_count}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(row.cpl) > 0 ? `R$ ${Number(row.cpl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{row.converted_count}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(row.cpa) > 0 ? `R$ ${Number(row.cpa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            R$ {Number(row.revenue).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-semibold ${Number(row.roi_pct) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {Number(row.spend) > 0 ? `${row.roi_pct}%` : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}

          {/* Row 3 — Channel Table + Funnel */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 metric-card">
              <h2 className="text-sm font-semibold text-foreground mb-3">Canais de Origem</h2>
              <ChannelTable data={channels ?? []} />
            </div>
            <div className="lg:col-span-2 metric-card">
              <h2 className="text-sm font-semibold text-foreground mb-3">Funil de Conversão</h2>
              {funnel && <MarketingFunnelChart data={funnel} />}
            </div>
          </div>

          {/* Row 3 — Agent Performance */}
          <div className="metric-card">
            <h2 className="text-sm font-semibold text-foreground mb-3">Desempenho por Agente</h2>
            <AgentPerformanceTable
              data={agents ?? []}
              userNames={userNameMap ?? new Map()}
            />
          </div>

          {/* Row 4 — Timeline Chart */}
          {timelineChartData.length > 0 && (
            <div className="metric-card">
              <h2 className="text-sm font-semibold text-foreground mb-3">Leads por Canal ao Longo do Tempo</h2>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timelineChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: 12,
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    {uniqueChannels.map((ch, i) => (
                      <Bar
                        key={ch}
                        dataKey={ch}
                        stackId="leads"
                        fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]}
                        radius={i === uniqueChannels.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
