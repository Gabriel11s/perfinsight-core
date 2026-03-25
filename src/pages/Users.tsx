import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users as UsersIcon, Search, MapPin, ArrowUpRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MetricBar } from '@/components/dashboard/MetricBar';
import { UserCard } from '@/components/dashboard/UserCard';
import { useTrackerSessions, useGhlUserNames, useGhlLocationNames } from '@/hooks/use-tracker-data';
import { useTrackerKpis } from '@/hooks/use-tracker-kpis';
import { useOnlineUsers } from '@/hooks/use-presence';
import { useEnabledGhlEvents } from '@/hooks/use-ghl-events';
import { useUserGeoMap } from '@/hooks/use-geo-sessions';
import { resolveName, formatMinutes } from '@/lib/helpers';
import { differenceInDays } from 'date-fns';
import { GhlWarningBanner } from '@/components/dashboard/GhlWarningBanner';
import { useSettings } from '@/hooks/use-settings';
import { useFilters } from '@/hooks/use-filters';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { EventCountBadges } from '@/components/dashboard/ActivityFeed';

type SortKey = 'name' | 'minutes' | 'sessions' | 'events';

const FLAG_EMOJI: Record<string, string> = {
  'United States': '🇺🇸', 'Brazil': '🇧🇷', 'Canada': '🇨🇦', 'United Kingdom': '🇬🇧',
  'Australia': '🇦🇺', 'Germany': '🇩🇪', 'France': '🇫🇷', 'India': '🇮🇳',
  'Mexico': '🇲🇽', 'Spain': '🇪🇸', 'Italy': '🇮🇹', 'Netherlands': '🇳🇱',
  'Japan': '🇯🇵', 'Singapore': '🇸🇬',
};

export default function UsersPage() {
  const navigate = useNavigate();
  const { data: sessions = [], isLoading } = useTrackerSessions();
  const { data: userNames } = useGhlUserNames();
  const { data: locationNames } = useGhlLocationNames();
  const { data: events = [] } = useEnabledGhlEvents();
  const { data: userGeoMap } = useUserGeoMap();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('minutes');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'low' | 'inactive' | 'online'>('all');
  const { onlineUserIds, onlineCount, userPages } = useOnlineUsers();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { dateRange } = useFilters();
  const { data: settings } = useSettings();
  const includeEvents = settings?.preferences?.include_events_in_last_active ?? false;
  const dailyHealthTarget = settings?.thresholds?.daily_health_minutes ?? 10;

  const userEventCounts = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    events.forEach(e => {
      if (!e.user_counts) return;
      Object.entries(e.user_counts).forEach(([userId, count]) => {
        if (!map.has(userId)) map.set(userId, {});
        const counts = map.get(userId)!;
        counts[e.event_type] = (counts[e.event_type] || 0) + count;
      });
    });
    return map;
  }, [events]);

  const userData = useMemo(() => {
    const map = new Map<string, {
      minutes: number; sessions: number; pages: Set<string>; locations: Set<string>; lastActivity: string;
    }>();
    sessions.forEach(s => {
      const uid = s.user_id;
      if (!map.has(uid)) map.set(uid, { minutes: 0, sessions: 0, pages: new Set(), locations: new Set(), lastActivity: '' });
      const e = map.get(uid)!;
      e.minutes += Math.round((s.duration_seconds || 0) / 60);
      e.sessions += 1;
      if (s.page_path) e.pages.add(s.page_path);
      if (s.location_id) e.locations.add(s.location_id);
      if (!e.lastActivity || s.started_at > e.lastActivity) e.lastActivity = s.started_at;
    });

    if (includeEvents) {
      events.forEach(e => {
        if (!e.user_counts) return;
        Object.keys(e.user_counts).forEach(userId => {
          if (!map.has(userId)) map.set(userId, { minutes: 0, sessions: 0, pages: new Set(), locations: new Set(), lastActivity: '' });
          const userState = map.get(userId)!;
          if (!userState.lastActivity || e.event_date > userState.lastActivity) userState.lastActivity = e.event_date;
        });
      });
    }

    const daysSelected = Math.max(1, differenceInDays(dateRange.to, dateRange.from) + 1);
    const targetMinutes = dailyHealthTarget * daysSelected;

    return Array.from(map.entries()).map(([id, v]) => {
      const eventCounts = userEventCounts.get(id) || {};
      const totalEvents = Object.values(eventCounts).reduce((a, b) => a + b, 0);
      let status: 'active' | 'low' | 'inactive' = 'inactive';
      if (v.minutes >= targetMinutes) status = 'active';
      else if (v.minutes > 0) status = 'low';

      return {
        id,
        name: resolveName(userNames, id),
        locationName: v.locations.size === 1
          ? resolveName(locationNames, Array.from(v.locations)[0])
          : v.locations.size > 1 ? `${v.locations.size} locations` : 'No location',
        locations: Array.from(v.locations),
        minutes: v.minutes,
        sessions: v.sessions,
        lastActivity: v.lastActivity,
        status,
        eventCounts,
        totalEvents,
      };
    });
  }, [sessions, userNames, locationNames, userEventCounts, dateRange, dailyHealthTarget, includeEvents, events]);

  const filtered = useMemo(() => {
    let list = userData;
    if (statusFilter === 'online') list = list.filter(u => onlineUserIds.has(u.id));
    else if (statusFilter !== 'all') list = list.filter(u => u.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(u => u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'minutes') return b.minutes - a.minutes;
      if (sortBy === 'sessions') return b.sessions - a.sessions;
      if (sortBy === 'events') return b.totalEvents - a.totalEvents;
      return 0;
    });
    return list;
  }, [userData, search, sortBy, statusFilter, onlineUserIds]);

  const { data: kpiData } = useTrackerKpis();
  const totalUsers = kpiData?.uniqueUsers ?? userData.length;
  const activeUsers = userData.filter(u => u.status === 'active').length;
  const atRisk = userData.filter(u => u.status === 'inactive').length;
  const totalEvents = events.reduce((acc, e) => acc + e.event_count, 0);

  const selectedUser = selectedUserId ? userData.find(u => u.id === selectedUserId) : null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-32 skeleton" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-48 skeleton rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header + Metric Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display">Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Activity and adoption tracking</p>
        </div>
        <MetricBar items={[
          { label: 'Users', value: totalUsers, dotColor: 'hsl(199, 89%, 48%)' },
          { label: 'Active', value: activeUsers, dotColor: 'hsl(142, 71%, 45%)' },
          { label: 'At Risk', value: atRisk, dotColor: 'hsl(0, 84%, 60%)' },
          { label: 'Online', value: onlineCount, dotColor: 'hsl(142, 71%, 45%)', pulse: true },
        ]} />
      </div>

      <GhlWarningBanner />

      {/* Search & Filters + Sort */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users..."
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
              <SelectItem value="events">Events</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-full border border-border/50">
          {(['all', 'online', 'active', 'low', 'inactive'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 flex items-center gap-1.5 ${
                statusFilter === s
                  ? s === 'online' || s === 'active' ? 'bg-emerald-500/10 text-emerald-600 shadow-sm'
                  : s === 'low' ? 'bg-amber-500/10 text-amber-600 shadow-sm'
                  : s === 'inactive' ? 'bg-red-500/10 text-red-600 shadow-sm'
                  : 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s === 'online' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />}
              {s === 'all' ? 'All' : s === 'online' ? `Online${onlineCount > 0 ? ` (${onlineCount})` : ''}` : s === 'active' ? 'Active' : s === 'low' ? 'At Risk' : 'Inactive'}
            </button>
          ))}
        </div>
      </div>

      {/* Card Grid */}
      {filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20 px-6">
          <UsersIcon className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No users found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 stagger-children">
          {filtered.map(u => (
            <UserCard
              key={u.id}
              id={u.id}
              name={u.name}
              locationName={u.locationName}
              minutes={u.minutes}
              sessions={u.sessions}
              totalEvents={u.totalEvents}
              eventCounts={u.eventCounts}
              status={u.status}
              isOnline={onlineUserIds.has(u.id)}
              geoInfo={userGeoMap.get(u.id)}
              onClick={() => setSelectedUserId(u.id)}
            />
          ))}
        </div>
      )}

      {/* User Preview Sheet */}
      <Sheet open={!!selectedUserId} onOpenChange={(open) => !open && setSelectedUserId(null)}>
        <SheetContent className="w-full sm:max-w-md border-border/50 bg-card/95 backdrop-blur-xl">
          {selectedUser && (
            <div className="space-y-5 pt-2">
              <SheetHeader className="text-left space-y-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary text-lg font-bold">
                      {selectedUser.name.slice(0, 2).toUpperCase()}
                    </div>
                    {onlineUserIds.has(selectedUser.id) && (
                      <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-card" />
                    )}
                  </div>
                  <div>
                    <SheetTitle className="text-lg">{selectedUser.name}</SheetTitle>
                    <div className="mt-0.5">
                      {onlineUserIds.has(selectedUser.id) ? (
                        <span className="text-xs text-emerald-500 font-medium">
                          Online — {userPages.get(selectedUser.id) || 'Unknown page'}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Offline</span>
                      )}
                    </div>
                  </div>
                </div>
              </SheetHeader>

              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="glass-card p-3 text-center">
                  <p className="text-lg font-bold font-display">{formatMinutes(selectedUser.minutes)}</p>
                  <p className="text-[10px] text-muted-foreground">Active Time</p>
                </div>
                <div className="glass-card p-3 text-center">
                  <p className="text-lg font-bold font-display">{selectedUser.sessions}</p>
                  <p className="text-[10px] text-muted-foreground">Sessions</p>
                </div>
                <div className="glass-card p-3 text-center">
                  <p className="text-lg font-bold font-display">{selectedUser.totalEvents}</p>
                  <p className="text-[10px] text-muted-foreground">Events</p>
                </div>
              </div>

              {/* Locations */}
              {selectedUser.locations.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Locations</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedUser.locations.map(locId => (
                      <span key={locId} className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11px]">
                        <MapPin className="h-2.5 w-2.5 text-muted-foreground" />
                        {resolveName(locationNames, locId)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Geo info */}
              {userGeoMap.get(selectedUser.id) && (() => {
                const geo = userGeoMap.get(selectedUser.id)!;
                return (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Accessing From</p>
                    <div className="glass-card px-3 py-2 flex items-center gap-2 text-sm">
                      <span className="text-base">{FLAG_EMOJI[geo.country] || '🌐'}</span>
                      <div>
                        <p className="font-medium">{geo.city}</p>
                        <p className="text-xs text-muted-foreground">
                          {geo.region ? `${geo.region}, ` : ''}{geo.country}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Events */}
              {selectedUser.totalEvents > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">GHL Activity</p>
                  <EventCountBadges counts={selectedUser.eventCounts} limit={8} />
                </div>
              )}

              {/* CTA */}
              <Button
                className="w-full gap-2"
                onClick={() => navigate(`/users/${encodeURIComponent(selectedUser.id)}`)}
              >
                View Full Profile <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
