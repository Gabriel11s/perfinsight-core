import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GhlWarningBanner } from '@/components/dashboard/GhlWarningBanner';
import { EventSummaryCards } from '@/components/dashboard/EventSummaryCards';
import { SessionMap } from '@/components/dashboard/SessionMap';
import { ActivityChart } from '@/components/dashboard/ActivityChart';
import { GhlActivityPieChart } from '@/components/dashboard/GhlActivityPieChart';
import { useTrackerSessions, useGhlUserNames, useGhlLocationNames } from '@/hooks/use-tracker-data';
import { useEnabledGhlEvents, aggregateEventsByTopic } from '@/hooks/use-ghl-events';
import { useGeoSessions } from '@/hooks/use-geo-sessions';
import { useTrackerKpis } from '@/hooks/use-tracker-kpis';
import { useHourlySessionData, buildHourlyChartData, useDailyActivityChart, useHourlyEventCounts } from '@/hooks/use-hourly-chart-data';
import { useFeatureBreakdown } from '@/hooks/use-feature-breakdown';
import { useFilters } from '@/hooks/use-filters';
import { formatDuration, formatMinutes, resolveName } from '@/lib/helpers';
import {
  Clock, Hash, Users, MapPin, Timer, TrendingDown, Activity, Wifi,
  ChevronRight, ArrowUpRight,
} from 'lucide-react';
import { useOnlineUsers } from '@/hooks/use-presence';
import {
  AreaChart, Area, ResponsiveContainer,
} from 'recharts';
import { differenceInDays } from 'date-fns';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export default function OverviewPage() {
  const { dateRange, timezone } = useFilters();
  const isHourly = differenceInDays(dateRange.to, dateRange.from) === 0;
  const { data: sessions = [], isLoading } = useTrackerSessions();
  const { data: userNames } = useGhlUserNames();
  const { data: locationNames } = useGhlLocationNames();
  const { data: ghlEvents = [], enabledEvents } = useEnabledGhlEvents();
  const { data: hourlyEventRows = [] } = useHourlyEventCounts();
  const { data: geoData } = useGeoSessions();
  const geoPoints = geoData?.points ?? [];
  const { onlineCount, onlineUserIds, data: onlinePresence = [] } = useOnlineUsers();
  const { data: kpiData } = useTrackerKpis();
  const { data: hourlySessionRows = [] } = useHourlySessionData();
  const { data: dailyChartData = [] } = useDailyActivityChart();

  const kpis = {
    activeMinutes: kpiData?.activeMinutes ?? 0,
    sessions: kpiData?.totalSessions ?? 0,
    uniqueUsers: kpiData?.uniqueUsers ?? 0,
    uniqueLocations: kpiData?.uniqueLocations ?? 0,
    avgDuration: kpiData?.avgDuration ?? 0,
    bounceRate: kpiData?.bounceRate ?? 0,
  };

  // KPI event total — used to scale hourly chart so bars sum to this exact number
  const kpiEventTotal = useMemo(() => ghlEvents.reduce((acc, e) => acc + e.event_count, 0), [ghlEvents]);

  const dailyData = useMemo(() => {
    // HOURLY VIEW — session data from RPC, event data from RPC (no row cap).
    // Scaled to match KPI total (UTC-date vs timezone-hour boundary mismatch fix).
    if (isHourly) {
      return buildHourlyChartData(hourlySessionRows, hourlyEventRows, dateRange, timezone, kpiEventTotal);
    }

    // DAILY VIEW — session minutes + event counts from RPCs (no pagination cap).
    // Event counts use the same source table + date format as the GHL Events KPI,
    // guaranteeing sum(chart_bars) === KPI total.
    return dailyChartData;
  }, [dailyChartData, hourlyEventRows, hourlySessionRows, dateRange, isHourly, timezone, kpiEventTotal]);

  // Sparkline data: last 7 entries
  const sparklineData = useMemo(() => dailyData.slice(-7), [dailyData]);

  const { data: featureBreakdown = [] } = useFeatureBreakdown();
  const featurePieData = useMemo(() =>
    featureBreakdown.map(f => ({ name: f.name, count: f.minutes })),
    [featureBreakdown],
  );

  const [pieMode, setPieMode] = useState<'events' | 'usage'>('events');

  const eventCounts = useMemo(() => aggregateEventsByTopic(ghlEvents), [ghlEvents]);
  const ghlUsageData = useMemo(() => {
    return Object.entries(eventCounts)
      .filter(([_, count]) => count > 0)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [eventCounts]);

  const topUsers = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach(s => map.set(s.user_id, (map.get(s.user_id) || 0) + Math.round((s.duration_seconds || 0) / 60)));
    return Array.from(map.entries())
      .map(([id, min]) => ({ id, name: resolveName(userNames, id), minutes: min }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6);
  }, [sessions, userNames]);

  const topLocations = useMemo(() => {
    const map = new Map<string, { minutes: number; users: Set<string> }>();
    sessions.forEach(s => {
      if (!map.has(s.location_id)) map.set(s.location_id, { minutes: 0, users: new Set() });
      const e = map.get(s.location_id)!;
      e.minutes += Math.round((s.duration_seconds || 0) / 60);
      e.users.add(s.user_id);
    });
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, name: resolveName(locationNames, id), minutes: v.minutes, users: v.users.size }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6);
  }, [sessions, locationNames]);

  // Online users for the hero card
  const recentOnlineUsers = useMemo(() => {
    return onlinePresence
      .slice(0, 3)
      .map(p => ({ id: p.user_id, name: resolveName(userNames, p.user_id) }));
  }, [onlinePresence, userNames]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton" />
        <div className="h-[360px] skeleton rounded-xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 skeleton rounded-xl" />)}
        </div>
        <div className="h-72 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight font-display">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          GoHighLevel usage analytics across your organization
        </p>
      </div>

      <GhlWarningBanner />

      {/* KPI Bento Grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 stagger-children">
        {/* Online Now — Hero Card */}
        <div className="metric-card col-span-2 lg:col-span-2 relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Online Now</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-4xl font-extrabold tracking-tight font-display text-emerald-400">
                  {onlineCount}
                </span>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
              </div>
            </div>
            <div className="rounded-xl p-2.5 bg-emerald-500/10 text-emerald-500">
              <Wifi className="h-5 w-5" />
            </div>
          </div>
          {recentOnlineUsers.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <div className="flex -space-x-2">
                {recentOnlineUsers.map(u => (
                  <div
                    key={u.id}
                    className="h-6 w-6 rounded-full bg-primary/15 text-primary text-[9px] font-bold flex items-center justify-center border-2 border-card"
                  >
                    {u.name.slice(0, 2).toUpperCase()}
                  </div>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {recentOnlineUsers.map(u => u.name.split(' ')[0]).join(', ')}
                {onlineCount > 3 && ` +${onlineCount - 3}`}
              </span>
            </div>
          )}
        </div>

        {/* Active Time with sparkline */}
        <div className="metric-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Active Time</p>
              <p className="text-[28px] font-extrabold tracking-tight leading-none mt-1 font-display">
                {formatMinutes(kpis.activeMinutes)}
              </p>
            </div>
            <div className="rounded-xl p-2.5 bg-primary/10 text-primary">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          {sparklineData.length > 1 && (
            <div className="mt-2 h-8 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparklineData}>
                  <defs>
                    <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="minutes"
                    stroke="hsl(199, 89%, 48%)"
                    strokeWidth={1.5}
                    fill="url(#sparkGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Sessions */}
        <div className="metric-card" style={{ borderLeft: '2px solid hsl(38, 92%, 50%)' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sessions</p>
              <p className="text-[28px] font-extrabold tracking-tight leading-none mt-1 font-display">
                {kpis.sessions.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl p-2.5 bg-amber-500/10 text-amber-500">
              <Hash className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {kpis.uniqueUsers} users
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {kpis.uniqueLocations} locations
            </span>
          </div>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card px-4 py-3 flex items-center gap-3">
          <div className="rounded-lg p-2 bg-violet-500/10 text-violet-500">
            <Timer className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg Duration</p>
            <p className="text-sm font-bold">{formatDuration(kpis.avgDuration)}</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3 flex items-center gap-3">
          <div className="rounded-lg p-2 bg-rose-500/10 text-rose-500">
            <TrendingDown className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bounce Rate</p>
            <p className="text-sm font-bold">{kpis.bounceRate}%</p>
          </div>
        </div>
        <div className="glass-card px-4 py-3 flex items-center gap-3">
          <div className="rounded-lg p-2 bg-cyan-500/10 text-cyan-500">
            <Activity className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">GHL Events</p>
            <p className="text-sm font-bold">{ghlEvents.reduce((acc, e) => acc + e.event_count, 0).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* GHL Event Summary Cards */}
      {ghlEvents.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">GHL Activity</h3>
              <p className="text-[11px] text-muted-foreground">Click a card to see detailed breakdown</p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {ghlEvents.reduce((acc, e) => acc + e.event_count, 0).toLocaleString()} events
            </span>
          </div>
          <EventSummaryCards events={ghlEvents} enabledEvents={enabledEvents} />
        </div>
      )}

      {/* Activity Chart */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Activity Over Time</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Screen time and GHL events</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-1.5 rounded-sm" style={{ background: 'hsl(199, 89%, 48%)', opacity: 0.6 }} />
              Minutes
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: 'hsl(38, 92%, 50%)' }} />
              Events
            </span>
          </div>
        </div>
        <ActivityChart data={dailyData} height={280} showBrush={!isHourly} />
      </div>

      {/* World Map */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'hsl(var(--glass-bg))', borderColor: 'hsl(var(--glass-border))' }}>
        <SessionMap points={geoPoints} />
      </div>

      {/* Bottom Section: Tabs + Pie */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Tabbed Panel */}
        <div className="glass-card p-5 lg:col-span-3">
          <Tabs defaultValue="users" className="w-full">
            <TabsList className="w-full justify-start bg-muted/30 mb-4">
              <TabsTrigger value="users" className="text-xs">Top Users</TabsTrigger>
              <TabsTrigger value="locations" className="text-xs">Top Locations</TabsTrigger>
            </TabsList>

            {/* Top Users */}
            <TabsContent value="users" className="mt-0">
              {topUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No user data yet</p>
              ) : (
                <div className="space-y-1">
                  {topUsers.map((u, i) => (
                    <Link
                      key={u.id}
                      to={`/users/${encodeURIComponent(u.id)}`}
                      className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/30 transition-colors group"
                    >
                      <span className="text-[10px] text-muted-foreground/40 font-bold tabular-nums w-4 text-right">
                        {i + 1}
                      </span>
                      <div className="relative">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0 group-hover:bg-primary/20 transition-colors">
                          {u.name.slice(0, 2).toUpperCase()}
                        </div>
                        {onlineUserIds.has(u.id) && (
                          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-card" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{u.name}</p>
                      </div>
                      <span className="text-sm font-bold tabular-nums">{formatMinutes(u.minutes)}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                    </Link>
                  ))}
                  <Link to="/users" className="flex items-center justify-center gap-1 text-xs text-primary hover:text-primary/80 pt-2 transition-colors">
                    View all users <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </TabsContent>

            {/* Top Locations */}
            <TabsContent value="locations" className="mt-0">
              {topLocations.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No location data yet</p>
              ) : (
                <div className="space-y-1">
                  {topLocations.map((l, i) => (
                    <Link
                      key={l.id}
                      to={`/locations/${encodeURIComponent(l.id)}`}
                      className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/30 transition-colors group"
                    >
                      <span className="text-[10px] text-muted-foreground/40 font-bold tabular-nums w-4 text-right">
                        {i + 1}
                      </span>
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                        <MapPin className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{l.name}</p>
                        <p className="text-[11px] text-muted-foreground">{l.users} users</p>
                      </div>
                      <span className="text-sm font-bold tabular-nums">{formatMinutes(l.minutes)}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                    </Link>
                  ))}
                  <Link to="/locations" className="flex items-center justify-center gap-1 text-xs text-primary hover:text-primary/80 pt-2 transition-colors">
                    View all locations <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </TabsContent>

          </Tabs>
        </div>

        {/* Breakdown Pie — Events / Usage toggle */}
        <div className="glass-card p-5 lg:col-span-2 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold">Breakdown</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {pieMode === 'events' ? 'Event distribution' : 'Feature usage (minutes)'}
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-full border border-border/50">
              <button
                onClick={() => setPieMode('events')}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-all ${
                  pieMode === 'events' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >Events</button>
              <button
                onClick={() => setPieMode('usage')}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-all ${
                  pieMode === 'usage' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >Usage</button>
            </div>
          </div>
          <div className="flex-1 w-full min-h-[220px]">
            <GhlActivityPieChart
              data={pieMode === 'events' ? ghlUsageData : featurePieData}
              valueLabel={pieMode === 'events' ? 'events' : 'minutes'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
