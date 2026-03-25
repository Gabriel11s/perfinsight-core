import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/hooks/use-filters';

export interface GeoPoint {
  geo_city: string;
  geo_region: string;
  geo_country: string;
  geo_lat: number;
  geo_lon: number;
  session_count: number;
  total_minutes: number;
  unique_users: number;
}

export interface UserGeoInfo {
  lat: number;
  lon: number;
  city: string;
  region: string;
  country: string;
  session_count: number;
}

/**
 * Fetches aggregated geo data for the current date range via server-side RPCs.
 *
 * Uses `get_geo_session_aggregates` RPC which groups by city in Postgres,
 * returning one row per city with accurate totals. No pagination cap.
 *
 * Note: Raw tracker_page_sessions are deleted after 7 days by pg_cron.
 * Geo data is only available on raw sessions (not on daily summaries).
 * For date ranges > 7 days, geo data will only cover the most recent 7 days.
 */
export function useGeoSessions() {
  const { dateRange } = useFilters();

  return useQuery({
    queryKey: ['geo-sessions', dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      // Fetch city aggregates and per-user geo info in parallel
      const [geoRes, userGeoRes] = await Promise.all([
        supabase.rpc('get_geo_session_aggregates', {
          p_start: dateRange.from.toISOString(),
          p_end: dateRange.to.toISOString(),
        }),
        supabase.rpc('get_user_geo_latest', {
          p_start: dateRange.from.toISOString(),
          p_end: dateRange.to.toISOString(),
        }),
      ]);

      if (geoRes.error) throw geoRes.error;

      const points: GeoPoint[] = (geoRes.data || []).map((r: any) => ({
        geo_city: r.geo_city,
        geo_region: r.geo_region,
        geo_country: r.geo_country,
        geo_lat: r.geo_lat,
        geo_lon: r.geo_lon,
        session_count: Number(r.session_count),
        total_minutes: Math.round(Number(r.total_seconds) / 60),
        unique_users: Number(r.unique_users),
      }));

      // Build per-user geo mapping
      const userGeoMap = new Map<string, UserGeoInfo>();
      if (userGeoRes.data) {
        for (const r of userGeoRes.data as any[]) {
          userGeoMap.set(r.user_id, {
            lat: r.geo_lat ?? 0,
            lon: r.geo_lon ?? 0,
            city: r.geo_city || 'Unknown',
            region: r.geo_region || '',
            country: r.geo_country || '',
            session_count: 1,
          });
        }
      }

      return {
        points: points.sort((a, b) => b.session_count - a.session_count),
        userGeoMap,
      };
    },
    staleTime: 60_000,
  });
}

/**
 * Convenience hook to get just the GeoPoint array (backwards-compatible).
 */
export function useGeoPoints() {
  const result = useGeoSessions();
  return {
    ...result,
    data: result.data?.points ?? [],
  };
}

/**
 * Hook to get per-user geo info map.
 */
export function useUserGeoMap() {
  const result = useGeoSessions();
  return {
    ...result,
    data: result.data?.userGeoMap ?? new Map<string, UserGeoInfo>(),
  };
}
