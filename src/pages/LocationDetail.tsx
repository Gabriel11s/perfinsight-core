import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Clock, Hash, Users, Calendar, Shield, Activity, Wifi } from 'lucide-react';
import { ActivityChart } from '@/components/dashboard/ActivityChart';
import { useTrackerSessions, useGhlUserNames, useGhlLocationNames } from '@/hooks/use-tracker-data';
import { useEnabledGhlEvents, aggregateEventsByTopic } from '@/hooks/use-ghl-events';
import { EventSummaryCards } from '@/components/dashboard/EventSummaryCards';
import { GhlActivityPieChart } from '@/components/dashboard/GhlActivityPieChart';
import { resolveName, formatDuration, formatMinutes } from '@/lib/helpers';
import { useTrackerKpis } from '@/hooks/use-tracker-kpis';
import { useHourlySessionData, buildHourlyChartData, useDailyActivityChart, useHourlyEventCounts } from '@/hooks/use-hourly-chart-data';
import { useFeatureBreakdown } from '@/hooks/use-feature-breakdown';
import { useOnlineUsers } from '@/hooks/use-presence';
import { differenceInDays } from 'date-fns';
import { useFilters } from '@/hooks/use-filters';

export default function LocationDetailPage() {
  const { locationId } = useParams<{ locationId: string }>();
  const { dateRange, timezone } = useFilters();
  const { data: sessions = [] } = useTrackerSessions();
  const { data: userNames } = useGhlUserNames();
  const { data: locationNames } = useGhlLocationNames();
  const { data: locationEvents = [], enabledEvents } = useEnabledGhlEvents({ locationId });
  const { data: hourlyEventRows = [] } = useHourlyEventCounts({ locationId });
  const { onlineUserIds, userPages } = useOnlineUsers({ locationId });

  const totalLocationEvents = locationEvents.reduce((acc, e) => acc + e.event_count, 0);

  const locSessions = useMemo(() => sessions.filter(s => s.location_id === locationId), [sessions, locationId]);
  const name = resolveName(locationNames, locationId || '');

  const { data: kpiData } = useTrackerKpis({ locationId });
  const { data: hourlySessionRows = [] } = useHourlySessionData({ locationId });
  const { data: dailyChartData = [] } = useDailyActivityChart({ locationId });
  const kpis = useMemo(() => {
    const users = kpiData?.uniqueUsers ?? new Set(locSessions.map(s => s.user_id)).size;
    return {
      totalMin: kpiData?.activeMinutes ?? Math.round(locSessions.reduce((s, ss) => s + (ss.duration_seconds || 0), 0) / 60),
      sessions: kpiData?.totalSessions ?? locSessions.length,
      users,
      avgDur: kpiData?.avgDuration ?? 0,
    };
  }, [locSessions, kpiData]);

  const eventCounts = useMemo(() => aggregateEventsByTopic(locationEvents), [locationEvents]);
  const ghlUsageData = useMemo(() => {
    return Object.entries(eventCounts)
      .filter(([_, count]) => count > 0)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [eventCounts]);

  const isHourly = differenceInDays(dateRange.to, dateRange.from) === 0;

  const daily = useMemo(() => {
    if (isHourly) {
      return buildHourlyChartData(hourlySessionRows, hourlyEventRows, dateRange, timezone, totalLocationEvents);
    }
    return dailyChartData;
  }, [dailyChartData, hourlyEventRows, hourlySessionRows, dateRange, isHourly, timezone, totalLocationEvents]);

  const topUsers = useMemo(() => {
    const map = new Map<string, { minutes: number; sessions: number }>();
    locSessions.forEach(s => {
      if (!map.has(s.user_id)) map.set(s.user_id, { minutes: 0, sessions: 0 });
      const e = map.get(s.user_id)!;
      e.minutes += Math.round((s.duration_seconds || 0) / 60);
      e.sessions += 1;
    });
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, name: resolveName(userNames, id), ...v }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8);
  }, [locSessions, userNames]);

  const { data: featureBreakdown = [] } = useFeatureBreakdown({ locationId });
  const featurePieData = useMemo(() =>
    featureBreakdown.map(f => ({ name: f.name, count: f.minutes })),
    [featureBreakdown],
  );
  const [pieMode, setPieMode] = useState<'events' | 'usage'>('events');

  const health = kpis.totalMin >= 60 ? 'healthy' : kpis.totalMin >= 15 ? 'warning' : 'critical';
  const healthGradient = {
    healthy: 'from-emerald-500/8 via-transparent to-transparent',
    warning: 'from-amber-500/8 via-transparent to-transparent',
    critical: 'from-red-500/8 via-transparent to-transparent',
  };
  const healthColors = {
    healthy: 'bg-emerald-500/10 text-emerald-500',
    warning: 'bg-amber-500/10 text-amber-500',
    critical: 'bg-red-500/10 text-red-500',
  };
  const healthLabels = { healthy: 'Healthy', warning: 'At Risk', critical: 'Critical' };

  // Online users at this location
  const onlineHere = useMemo(() => {
    return topUsers.filter(u => onlineUserIds.has(u.id));
  }, [topUsers, onlineUserIds]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Back */}
      <Link to="/locations" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Locations
      </Link>

      {/* Hero Header */}
      <div className="glass-card p-5 relative overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-r ${healthGradient[health]} pointer-events-none`} />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl shrink-0 ${healthColors[health]}`}>
            <Shield className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold tracking-tight font-display">{name}</h1>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                health === 'healthy' ? 'status-healthy' : health === 'warning' ? 'status-warning' : 'status-critical'
              }`}>
                {healthLabels[health]}
              </span>
              {onlineHere.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-2 py-0.5 text-[10px] font-semibold">
                  <Wifi className="h-2.5 w-2.5" /> {onlineHere.length} online
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{locationId}</p>
          </div>

          {/* Inline KPIs */}
          <div className="flex gap-4 sm:gap-6 shrink-0">
            <div className="text-center">
              <p className="text-2xl font-extrabold font-display">{formatMinutes(kpis.totalMin)}</p>
              <p className="text-[10px] text-muted-foreground">Active Time</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-extrabold font-display">{kpis.sessions}</p>
              <p className="text-[10px] text-muted-foreground">Sessions</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-extrabold font-display">{kpis.users}</p>
              <p className="text-[10px] text-muted-foreground">Users</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-extrabold font-display">{totalLocationEvents}</p>
              <p className="text-[10px] text-muted-foreground">Events</p>
            </div>
          </div>
        </div>
      </div>

      {/* Online Users Panel */}
      {onlineHere.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <h3 className="text-sm font-semibold">Currently Online</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {onlineHere.map(u => (
              <Link
                key={u.id}
                to={`/users/${encodeURIComponent(u.id)}`}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 hover:bg-emerald-500/10 transition-colors"
              >
                <div className="h-6 w-6 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center">
                  {u.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-medium">{u.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                    {userPages.get(u.id) || 'browsing'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Event Summary Cards */}
      {locationEvents.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">GHL Activity</h3>
              <p className="text-[11px] text-muted-foreground">Click a card to see detailed breakdown</p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{totalLocationEvents.toLocaleString()} events</span>
          </div>
          <EventSummaryCards events={locationEvents} enabledEvents={enabledEvents} />
        </div>
      )}

      {/* Activity Chart */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Activity Over Time</h3>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-1.5 rounded-sm" style={{ background: 'hsl(160, 84%, 39%)', opacity: 0.6 }} /> Minutes
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: 'hsl(38, 92%, 50%)' }} /> Events
            </span>
          </div>
        </div>
        <ActivityChart data={daily} height={260} minutesColor="hsl(160, 84%, 39%)" eventsColor="hsl(38, 92%, 50%)" />
      </div>

      {/* Bottom: Users + Pie */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Users at location */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold mb-4">Users at This Location</h3>
          {topUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No users yet</p>
          ) : (
            <div className="space-y-1">
              {topUsers.map(u => (
                <Link
                  key={u.id}
                  to={`/users/${encodeURIComponent(u.id)}`}
                  className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/30 transition-colors group"
                >
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
                    <p className="text-xs text-muted-foreground">
                      {onlineUserIds.has(u.id) ? <span className="text-emerald-500">Online</span> : `${u.sessions} sessions`}
                    </p>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{formatMinutes(u.minutes)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Breakdown Pie — Events / Usage toggle */}
        <div className="glass-card p-5 flex flex-col">
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
