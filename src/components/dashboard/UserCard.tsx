import { Clock, Hash, MapPin, ChevronRight } from 'lucide-react';
import { EventCountBadges } from './ActivityFeed';
import { formatMinutes } from '@/lib/helpers';
import type { UserGeoInfo } from '@/hooks/use-geo-sessions';

const FLAG_EMOJI: Record<string, string> = {
  'United States': '🇺🇸', 'Brazil': '🇧🇷', 'Canada': '🇨🇦', 'United Kingdom': '🇬🇧',
  'Australia': '🇦🇺', 'Germany': '🇩🇪', 'France': '🇫🇷', 'India': '🇮🇳',
  'Mexico': '🇲🇽', 'Spain': '🇪🇸', 'Italy': '🇮🇹', 'Netherlands': '🇳🇱',
  'Japan': '🇯🇵', 'South Korea': '🇰🇷', 'Argentina': '🇦🇷', 'Colombia': '🇨🇴',
  'Portugal': '🇵🇹', 'Philippines': '🇵🇭', 'South Africa': '🇿🇦', 'Ireland': '🇮🇪',
  'New Zealand': '🇳🇿', 'Sweden': '🇸🇪', 'Norway': '🇳🇴', 'Denmark': '🇩🇰',
  'Switzerland': '🇨🇭', 'Belgium': '🇧🇪', 'Austria': '🇦🇹', 'Poland': '🇵🇱',
  'Singapore': '🇸🇬', 'United Arab Emirates': '🇦🇪',
};

interface UserCardProps {
  id: string;
  name: string;
  locationName: string;
  minutes: number;
  sessions: number;
  totalEvents: number;
  eventCounts: Record<string, number>;
  status: 'active' | 'low' | 'inactive';
  isOnline: boolean;
  geoInfo?: UserGeoInfo;
  onClick?: () => void;
}

const statusConfig = {
  active: { label: 'Active', class: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
  low: { label: 'Low Usage', class: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
  inactive: { label: 'Inactive', class: 'bg-red-500/10 text-red-500 border-red-500/20' },
};

export function UserCard({
  id, name, locationName, minutes, sessions, totalEvents, eventCounts, status, isOnline, geoInfo, onClick,
}: UserCardProps) {
  const cfg = statusConfig[status];

  return (
    <button
      onClick={onClick}
      className={`glass-card p-4 text-left w-full group transition-all duration-200 ${
        isOnline ? 'ring-1 ring-emerald-500/20' : ''
      }`}
    >
      {/* Top: Avatar + Name + Status */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold group-hover:bg-primary/20 transition-colors">
            {name.slice(0, 2).toUpperCase()}
          </div>
          {isOnline && (
            <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-card">
              <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-40" />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{name}</p>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 transition-colors" />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[9px] font-semibold ${cfg.class}`}>
              {cfg.label}
            </span>
            {isOnline && (
              <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 px-1.5 py-0 text-[9px] font-semibold">
                Online
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/30">
        <div>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> Time</p>
          <p className="text-sm font-bold tabular-nums">{formatMinutes(minutes)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Hash className="h-2.5 w-2.5" /> Sessions</p>
          <p className="text-sm font-bold tabular-nums">{sessions}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Events</p>
          <p className="text-sm font-bold tabular-nums">{totalEvents}</p>
        </div>
      </div>

      {/* Location */}
      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">{locationName}</span>
      </div>

      {/* Geo info */}
      {geoInfo && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{FLAG_EMOJI[geoInfo.country] || '🌐'}</span>
          <span className="truncate">{geoInfo.city}{geoInfo.region ? `, ${geoInfo.region}` : ''}</span>
        </div>
      )}

      {/* Event badges */}
      {totalEvents > 0 && (
        <div className="mt-2.5 pt-2 border-t border-border/20">
          <EventCountBadges counts={eventCounts} limit={4} />
        </div>
      )}
    </button>
  );
}
