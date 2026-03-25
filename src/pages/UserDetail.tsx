import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Clock, Hash, MapPin, Calendar, Activity, Wifi } from 'lucide-react';
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
import { useUserGeoMap } from '@/hooks/use-geo-sessions';
import { differenceInDays } from 'date-fns';
import { useFilters } from '@/hooks/use-filters';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const FLAG_EMOJI: Record<string, string> = {
  'United States': '🇺🇸', 'Brazil': '🇧🇷', 'Canada': '🇨🇦', 'United Kingdom': '🇬🇧',
  'Australia': '🇦🇺', 'Germany': '🇩🇪', 'France': '🇫🇷', 'India': '🇮🇳',
  'Mexico': '🇲🇽', 'Spain': '🇪🇸', 'Italy': '🇮🇹', 'Singapore': '🇸🇬',
};

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { dateRange, timezone } = useFilters();
  const { data: sessions = [] } = useTrackerSessions();
  const { data: userNames } = useGhlUserNames();
  const { data: locationNames } = useGhlLocationNames();
  const { data: userEvents = [], enabledEvents } = useEnabledGhlEvents({ userId });
  const { data: hourlyEventRows = [] } = useHourlyEventCounts({ userId });
  const { onlineUserIds, userPages } = useOnlineUsers();
  const { data: userGeoMap } = useUserGeoMap();
  const isOnline = onlineUserIds.has(userId || '');
  const geoInfo = userGeoMap.get(userId || '');

  const totalUserEvents = userEvents.reduce((acc, e) => acc + e.event_count, 0);

  const userSessions = useMemo(() => sessions.filter(s => s.user_id === userId), [sessions, userId]);
  const name = resolveName(userNames, userId || '');

  const { data: kpiData } = useTrackerKpis({ userId });
  const { data: hourlySessionRows = [] } = useHourlySessionData({ userId });
  const { data: dailyChartData = [] } = useDailyActivityChart({ userId });
  const kpis = useMemo(() => {
    const locations = new Set(userSessions.map(s => s.location_id));
    return {
      totalMin: kpiData?.activeMinutes ?? Math.round(userSessions.reduce((s, ss) => s + (ss.duration_seconds || 0), 0) / 60),
      sessions: kpiData?.totalSessions ?? userSessions.length,
      locations,
      avgDur: kpiData?.avgDuration ?? 0,
    };
  }, [userSessions, kpiData]);

  const eventCounts = useMemo(() => aggregateEventsByTopic(userEvents), [userEvents]);
  const ghlUsageData = useMemo(() => {
    return Object.entries(eventCounts)
      .filter(([_, count]) => count > 0)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [eventCounts]);

  const isHourly = differenceInDays(dateRange.to, dateRange.from) === 0;

  const daily = useMemo(() => {
    if (isHourly) {
      return buildHourlyChartData(hourlySessionRows, hourlyEventRows, dateRange, timezone, totalUserEvents);
    }
    return dailyChartData;
  }, [dailyChartData, hourlyEventRows, hourlySessionRows, dateRange, isHourly, timezone, totalUserEvents]);

  const { data: featureBreakdown = [] } = useFeatureBreakdown({ userId });
  const featurePieData = useMemo(() =>
    featureBreakdown.map(f => ({ name: f.name, count: f.minutes })),
    [featureBreakdown],
  );
  const [pieMode, setPieMode] = useState<'events' | 'usage'>('events');

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Back */}
      <Link to="/users" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Users
      </Link>

      {/* Hero Header */}
      <div className="glass-card p-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="relative shrink-0">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary text-xl font-bold">
              {name.slice(0, 2).toUpperCase()}
            </div>
            {isOnline && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-card">
                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-40" />
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold tracking-tight font-display">{name}</h1>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${isOnline ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-muted-foreground/30 bg-muted/50 text-muted-foreground'}`}>
                {isOnline ? <><Wifi className="h-2.5 w-2.5" /> Online</> : 'Offline'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{userId}</p>
            {/* Location tags */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Array.from(kpis.locations).map(locId => (
                <Link
                  key={locId}
                  to={`/locations/${encodeURIComponent(locId)}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] hover:bg-muted/50 transition-colors"
                >
                  <MapPin className="h-2.5 w-2.5 text-muted-foreground" />
                  {resolveName(locationNames, locId)}
                </Link>
              ))}
            </div>
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
              <p className="text-2xl font-extrabold font-display">{totalUserEvents}</p>
              <p className="text-[10px] text-muted-foreground">Events</p>
            </div>
          </div>
        </div>

        {/* Geo info inside hero */}
        {geoInfo && (
          <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="text-sm">{FLAG_EMOJI[geoInfo.country] || '🌐'}</span>
            Accessing from <span className="font-medium text-foreground">{geoInfo.city}{geoInfo.region ? `, ${geoInfo.region}` : ''}</span>, {geoInfo.country}
          </div>
        )}
      </div>

      {/* Event Summary Cards */}
      {userEvents.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">GHL Activity</h3>
              <p className="text-[11px] text-muted-foreground">Click a card to see detailed breakdown</p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{totalUserEvents.toLocaleString()} events</span>
          </div>
          <EventSummaryCards events={userEvents} enabledEvents={enabledEvents} />
        </div>
      )}

      {/* Activity Chart */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Activity Over Time</h3>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-1.5 rounded-sm" style={{ background: 'hsl(199, 89%, 48%)', opacity: 0.6 }} /> Minutes
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: 'hsl(38, 92%, 50%)' }} /> Events
            </span>
          </div>
        </div>
        <ActivityChart data={daily} height={260} minutesColor="hsl(199, 89%, 48%)" eventsColor="hsl(38, 92%, 50%)" />
      </div>

      {/* Breakdown Pie — Events / Usage toggle */}
      <div className="glass-card p-5">
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
        <div className="w-full min-h-[220px]">
          <GhlActivityPieChart
            data={pieMode === 'events' ? ghlUsageData : featurePieData}
            valueLabel={pieMode === 'events' ? 'events' : 'minutes'}
          />
        </div>
      </div>
    </div>
  );
}
