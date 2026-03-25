import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Search, Shield, Users, Clock, Hash, Activity, ChevronRight, Wifi } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MetricBar } from '@/components/dashboard/MetricBar';
import { useTrackerSessions, useGhlLocationNames } from '@/hooks/use-tracker-data';
import { useTrackerKpis } from '@/hooks/use-tracker-kpis';
import { useEnabledGhlEvents } from '@/hooks/use-ghl-events';
import { useOnlineUsers } from '@/hooks/use-presence';
import { EventCountBadges } from '@/components/dashboard/ActivityFeed';
import { resolveName, formatMinutes } from '@/lib/helpers';
import { format, parseISO, differenceInDays } from 'date-fns';
import { GhlWarningBanner } from '@/components/dashboard/GhlWarningBanner';
import { useSettings } from '@/hooks/use-settings';
import { useFilters } from '@/hooks/use-filters';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type SortKey = 'name' | 'minutes' | 'sessions' | 'users' | 'events';

export default function LocationsPage() {
  const { data: sessions = [], isLoading } = useTrackerSessions();
  const { data: locationNames } = useGhlLocationNames();
  const { data: events = [] } = useEnabledGhlEvents();
  const { onlineByLocation } = useOnlineUsers();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('minutes');
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'warning' | 'critical'>('all');

  const { dateRange } = useFilters();
  const { data: settings } = useSettings();
  const includeEvents = settings?.preferences?.include_events_in_last_active ?? false;
  const dailyHealthTarget = settings?.thresholds?.daily_health_minutes ?? 10;

  const locationEventCounts = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    events.forEach(e => {
      if (!e.location_id) return;
      if (!map.has(e.location_id)) map.set(e.location_id, {});
      const counts = map.get(e.location_id)!;
      counts[e.event_type] = (counts[e.event_type] || 0) + e.event_count;
    });
    return map;
  }, [events]);

  const locationData = useMemo(() => {
    const map = new Map<string, { minutes: number; sessions: number; users: Set<string>; lastActivity: string }>();
    sessions.forEach(s => {
      const lid = s.location_id || '(unknown)';
      if (!map.has(lid)) map.set(lid, { minutes: 0, sessions: 0, users: new Set(), lastActivity: '' });
      const e = map.get(lid)!;
      e.minutes += Math.round((s.duration_seconds || 0) / 60);
      e.sessions += 1;
      e.users.add(s.user_id);
      if (!e.lastActivity || s.started_at > e.lastActivity) e.lastActivity = s.started_at;
    });

    events.forEach(e => {
      if (!e.location_id) return;
      if (!map.has(e.location_id)) map.set(e.location_id, { minutes: 0, sessions: 0, users: new Set(), lastActivity: '' });
      if (includeEvents) {
        const locState = map.get(e.location_id)!;
        if (!locState.lastActivity || e.event_date > locState.lastActivity) locState.lastActivity = e.event_date;
      }
    });

    const daysSelected = Math.max(1, differenceInDays(dateRange.to, dateRange.from) + 1);
    const targetMinutes = dailyHealthTarget * daysSelected;

    return Array.from(map.entries()).map(([id, v]) => {
      const eventCounts = locationEventCounts.get(id) || {};
      const totalEvents = Object.values(eventCounts).reduce((a, b) => a + b, 0);
      let health: 'healthy' | 'warning' | 'critical' = 'critical';
      if (v.minutes >= targetMinutes) health = 'healthy';
      else if (v.minutes > 0) health = 'warning';

      return {
        id, name: resolveName(locationNames, id), minutes: v.minutes,
        sessions: v.sessions, users: v.users.size, lastActivity: v.lastActivity,
        health, eventCounts, totalEvents,
      };
    });
  }, [sessions, locationNames, events, locationEventCounts, dateRange, dailyHealthTarget, includeEvents]);

  const filtered = useMemo(() => {
    let list = locationData;
    if (statusFilter !== 'all') list = list.filter(l => l.health === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(l => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'minutes') return b.minutes - a.minutes;
      if (sortBy === 'sessions') return b.sessions - a.sessions;
      if (sortBy === 'users') return b.users - a.users;
      if (sortBy === 'events') return b.totalEvents - a.totalEvents;
      return 0;
    });
    return list;
  }, [locationData, search, sortBy, statusFilter]);

  const { data: kpiData } = useTrackerKpis();
  const total = kpiData?.uniqueLocations ?? locationData.length;
  const healthy = locationData.filter(l => l.health === 'healthy').length;
  const atRisk = locationData.filter(l => l.health === 'warning').length;
  const critical = locationData.filter(l => l.health === 'critical').length;
  const totalEvents = events.reduce((acc, e) => acc + e.event_count, 0);
  const maxMinutes = Math.max(...locationData.map(l => l.minutes), 1);

  const healthConfig = {
    healthy: { label: 'Healthy', icon: 'bg-emerald-500/10 text-emerald-500', badge: 'status-healthy' },
    warning: { label: 'At Risk', icon: 'bg-amber-500/10 text-amber-500', badge: 'status-warning' },
    critical: { label: 'Critical', icon: 'bg-red-500/10 text-red-500', badge: 'status-critical' },
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-40 skeleton" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 skeleton rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header + Metric Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display">Locations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sub-account health and adoption</p>
        </div>
        <MetricBar items={[
          { label: 'Locations', value: total, dotColor: 'hsl(199, 89%, 48%)' },
          { label: 'Healthy', value: healthy, dotColor: 'hsl(142, 71%, 45%)' },
          { label: 'At Risk', value: atRisk, dotColor: 'hsl(38, 92%, 50%)' },
          { label: 'Critical', value: critical, dotColor: 'hsl(0, 84%, 60%)' },
          { label: 'Events', value: totalEvents.toLocaleString(), dotColor: 'hsl(263, 70%, 58%)' },
        ]} />
      </div>

      <GhlWarningBanner />

      {/* Search & Filters + Sort */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search locations..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-muted/50 border-0 h-9 rounded-xl"
            />
          </div>
          <Select value={sortBy} onValueChange={v => setSortBy(v as SortKey)}>
            <SelectTrigger className="w-[130px] h-9 text-xs bg-muted/50 border-0 rounded-xl">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Active Time</SelectItem>
              <SelectItem value="sessions">Sessions</SelectItem>
              <SelectItem value="users">Users</SelectItem>
              <SelectItem value="events">Events</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-full border border-border/50">
          {(['all', 'healthy', 'warning', 'critical'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                statusFilter === s
                  ? s === 'healthy' ? 'bg-emerald-500/10 text-emerald-600 shadow-sm'
                  : s === 'warning' ? 'bg-amber-500/10 text-amber-600 shadow-sm'
                  : s === 'critical' ? 'bg-red-500/10 text-red-600 shadow-sm'
                  : 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s === 'all' ? 'All' : s === 'healthy' ? 'Healthy' : s === 'warning' ? 'At Risk' : 'Critical'}
            </button>
          ))}
        </div>
      </div>

      {/* Location Cards */}
      {filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20 px-6">
          <MapPin className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No locations found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="space-y-2 stagger-children">
          {filtered.map(l => {
            const hc = healthConfig[l.health];
            const onlineHere = onlineByLocation.get(l.id) || 0;
            const pct = Math.round((l.minutes / maxMinutes) * 100);

            return (
              <Link
                key={l.id}
                to={`/locations/${encodeURIComponent(l.id)}`}
                className="glass-card p-4 flex items-center gap-4 group hover:bg-muted/10 transition-all"
              >
                {/* Health icon */}
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${hc.icon}`}>
                  <Shield className="h-4 w-4" />
                </div>

                {/* Name + Health badge */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{l.name}</p>
                    <span className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[9px] font-semibold shrink-0 ${hc.badge}`}>
                      {hc.label}
                    </span>
                    {onlineHere > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-1.5 py-0 text-[9px] font-semibold shrink-0">
                        <Wifi className="h-2.5 w-2.5" /> {onlineHere} online
                      </span>
                    )}
                  </div>
                  {/* Activity bar */}
                  <div className="h-1 bg-muted/40 rounded-full overflow-hidden mt-2 max-w-xs">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background: l.health === 'healthy' ? 'hsl(160, 84%, 39%)' : l.health === 'warning' ? 'hsl(38, 92%, 50%)' : 'hsl(0, 72%, 51%)',
                      }}
                    />
                  </div>
                </div>

                {/* Metrics */}
                <div className="hidden sm:flex items-center gap-5 shrink-0">
                  <div className="text-center min-w-[50px]">
                    <p className="text-xs text-muted-foreground flex items-center gap-1 justify-center"><Users className="h-2.5 w-2.5" /> Users</p>
                    <p className="text-sm font-bold tabular-nums">{l.users}</p>
                  </div>
                  <div className="text-center min-w-[50px]">
                    <p className="text-xs text-muted-foreground flex items-center gap-1 justify-center"><Clock className="h-2.5 w-2.5" /> Time</p>
                    <p className="text-sm font-bold tabular-nums">{formatMinutes(l.minutes)}</p>
                  </div>
                  <div className="text-center min-w-[50px]">
                    <p className="text-xs text-muted-foreground flex items-center gap-1 justify-center"><Hash className="h-2.5 w-2.5" /> Sessions</p>
                    <p className="text-sm font-bold tabular-nums">{l.sessions}</p>
                  </div>
                  {l.totalEvents > 0 && (
                    <div className="flex items-center gap-1.5">
                      <EventCountBadges counts={l.eventCounts} limit={3} />
                    </div>
                  )}
                </div>

                {/* Last active + chevron */}
                <div className="hidden lg:flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground min-w-[60px] text-right">
                    {l.lastActivity
                      ? l.lastActivity.length === 10
                        ? format(parseISO(l.lastActivity), 'MMM dd')
                        : format(parseISO(l.lastActivity), 'MMM dd, HH:mm')
                      : '—'}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
