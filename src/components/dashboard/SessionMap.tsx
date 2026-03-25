import { useState, useMemo } from 'react';
import { GeoPoint } from '@/hooks/use-geo-sessions';
import { InteractiveWorldMap } from './InteractiveWorldMap';
import { ChevronDown, ChevronUp, Clock, Globe, MapPin, Users } from 'lucide-react';
import { useOnlineUsers } from '@/hooks/use-presence';

interface SessionMapProps {
  points: GeoPoint[];
}

const FLAG_EMOJI: Record<string, string> = {
  'United States': '🇺🇸', 'Brazil': '🇧🇷', 'Canada': '🇨🇦', 'United Kingdom': '🇬🇧',
  'Australia': '🇦🇺', 'Germany': '🇩🇪', 'France': '🇫🇷', 'India': '🇮🇳',
  'Mexico': '🇲🇽', 'Spain': '🇪🇸', 'Italy': '🇮🇹', 'Netherlands': '🇳🇱',
  'Japan': '🇯🇵', 'South Korea': '🇰🇷', 'Argentina': '🇦🇷', 'Colombia': '🇨🇴',
  'Portugal': '🇵🇹', 'Philippines': '🇵🇭', 'South Africa': '🇿🇦', 'Ireland': '🇮🇪',
  'New Zealand': '🇳🇿', 'Sweden': '🇸🇪', 'Norway': '🇳🇴', 'Denmark': '🇩🇰',
  'Switzerland': '🇨🇭', 'Belgium': '🇧🇪', 'Austria': '🇦🇹', 'Poland': '🇵🇱',
  'Chile': '🇨🇱', 'Peru': '🇵🇪', 'Israel': '🇮🇱', 'Singapore': '🇸🇬',
  'United Arab Emirates': '🇦🇪', 'Nigeria': '🇳🇬', 'Pakistan': '🇵🇰',
};

export function SessionMap({ points }: SessionMapProps) {
  const [mapMode, setMapMode] = useState<'activity' | 'online'>('activity');
  const [showAllCities, setShowAllCities] = useState(false);
  const { onlineUserIds } = useOnlineUsers();

  // Build online points: for now, reuse activity points but mark them as "online"
  // In a full implementation, cross-reference onlineUserIds with per-user geo data
  const onlinePoints = useMemo(() => {
    // Filter points that have users currently online
    // This is an approximation — exact per-user geo requires the enhanced hook
    return points.filter(p => p.unique_users > 0).map(p => ({
      ...p,
      // Approximate: show cities where activity exists
    }));
  }, [points, onlineUserIds]);

  // Country aggregation
  const countries = useMemo(() => {
    const countryMap = new Map<string, { users: number; minutes: number }>();
    for (const p of points) {
      const key = p.geo_country || 'Unknown';
      if (!countryMap.has(key)) countryMap.set(key, { users: 0, minutes: 0 });
      const entry = countryMap.get(key)!;
      entry.users += p.unique_users;
      entry.minutes += p.total_minutes;
    }
    return Array.from(countryMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [points]);

  const allCitiesSorted = useMemo(
    () => [...points].sort((a, b) => b.total_minutes - a.total_minutes),
    [points],
  );
  const visibleCities = showAllCities ? allCitiesSorted : allCitiesSorted.slice(0, 8);
  const maxCityMinutes = allCitiesSorted[0]?.total_minutes || 1;
  const hasMoreCities = allCitiesSorted.length > 8;

  return (
    <div className="space-y-0">
      {/* Interactive Map */}
      <InteractiveWorldMap
        points={points}
        onlinePoints={onlinePoints}
        mode={mapMode}
        onModeChange={setMapMode}
        height={360}
      />

      {/* City & Country breakdown below map */}
      {points.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2 p-5 pt-4">
          {/* Top Cities */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              <h4 className="text-xs font-semibold text-muted-foreground">Top Cities</h4>
            </div>
            <div className="space-y-2.5">
              {visibleCities.map((city, i) => {
                const pct = Math.round((city.total_minutes / maxCityMinutes) * 100);
                const h = Math.floor(city.total_minutes / 60);
                const m = city.total_minutes % 60;
                const timeLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
                return (
                  <div key={`${city.geo_city}-${city.geo_region}-${i}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm truncate max-w-[55%]">
                        {city.geo_city}
                        {city.geo_region ? <span className="text-muted-foreground">, {city.geo_region}</span> : ''}
                      </span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Users className="h-3 w-3" />{city.unique_users}
                        </span>
                        <span className="font-semibold tabular-nums flex items-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />{timeLabel}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {hasMoreCities && (
              <button
                onClick={() => setShowAllCities(!showAllCities)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-3 transition-colors"
              >
                {showAllCities ? (
                  <><ChevronUp className="h-3 w-3" /> Show less</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> Show all {allCitiesSorted.length} cities</>
                )}
              </button>
            )}
          </div>

          {/* Countries */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-3.5 w-3.5 text-primary" />
              <h4 className="text-xs font-semibold text-muted-foreground">Countries</h4>
            </div>
            <div className="space-y-2">
              {countries.slice(0, 8).map((c) => {
                const h = Math.floor(c.minutes / 60);
                const m = c.minutes % 60;
                const timeLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
                return (
                  <div key={c.name} className="flex items-center justify-between py-1.5 group hover:bg-muted/30 rounded-lg px-2 -mx-2 transition-colors">
                    <span className="text-sm flex items-center gap-2.5">
                      <span className="text-base">{FLAG_EMOJI[c.name] || '🌐'}</span>
                      {c.name}
                    </span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" />{c.users}
                      </span>
                      <span className="font-semibold tabular-nums">{timeLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {countries.length > 8 && (
              <p className="text-xs text-muted-foreground mt-2">
                +{countries.length - 8} more countries
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
