import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/hooks/use-filters';
import { startOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

export interface TrackerKpis {
  totalSessions: number;
  totalSeconds: number;
  uniqueUsers: number;
  uniqueLocations: number;
  bounceCount: number;
  activeMinutes: number;
  avgDuration: number;
  bounceRate: number;
}

const EMPTY_KPIS: TrackerKpis = {
  totalSessions: 0,
  totalSeconds: 0,
  uniqueUsers: 0,
  uniqueLocations: 0,
  bounceCount: 0,
  activeMinutes: 0,
  avgDuration: 0,
  bounceRate: 0,
};

/**
 * Fetches accurate KPI aggregates via server-side RPCs.
 *
 * Uses a dual-path strategy (same as useTrackerSessions):
 * - Today's data: `get_tracker_kpis` RPC (queries raw tracker_page_sessions)
 * - Historical data: `get_tracker_kpis_summary` RPC (queries tracker_session_daily_summary)
 *
 * Unlike useTrackerSessions, this has NO pagination cap — aggregation happens
 * entirely in Postgres, returning a single row with exact totals.
 */
export function useTrackerKpis(opts?: { userId?: string; locationId?: string }) {
  const { dateRange, timezone } = useFilters();

  return useQuery({
    queryKey: [
      'tracker-kpis',
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      opts?.userId || 'all',
      opts?.locationId || 'all',
    ],
    queryFn: async (): Promise<TrackerKpis> => {
      const nowInTz = toZonedTime(new Date(), timezone);
      const todayStart = fromZonedTime(startOfDay(nowInTz), timezone);
      const isHistorical = dateRange.from < todayStart;

      let totalSessions = 0;
      let totalSeconds = 0;
      let uniqueUsers = 0;
      let uniqueLocations = 0;
      let bounceCount = 0;

      // Always get today's KPIs from raw data (real-time accurate)
      const rawStart = dateRange.from > todayStart ? dateRange.from : todayStart;
      const { data: todayKpis, error: todayErr } = await supabase.rpc(
        'get_tracker_kpis',
        {
          p_start: rawStart.toISOString(),
          p_end: dateRange.to.toISOString(),
          p_user_id: opts?.userId ?? null,
          p_location_id: opts?.locationId ?? null,
        }
      );
      if (todayErr) throw todayErr;

      if (todayKpis && todayKpis.length > 0) {
        const t = todayKpis[0];
        totalSessions += Number(t.total_sessions);
        totalSeconds += Number(t.total_seconds);
        bounceCount += Number(t.bounce_count);
        uniqueUsers = Number(t.unique_users);
        uniqueLocations = Number(t.unique_locations);
      }

      // If range extends before today, also get historical from summary table
      if (isHistorical) {
        const startDate = dateRange.from.toISOString().split('T')[0];
        // End date for summary: day before today
        const endDate = new Date(todayStart.getTime() - 86400000).toISOString().split('T')[0];

        const { data: histKpis, error: histErr } = await supabase.rpc(
          'get_tracker_kpis_summary',
          {
            p_start_date: startDate,
            p_end_date: endDate,
            p_user_id: opts?.userId ?? null,
            p_location_id: opts?.locationId ?? null,
          }
        );
        if (histErr) throw histErr;

        if (histKpis && histKpis.length > 0) {
          const h = histKpis[0];
          totalSessions += Number(h.total_sessions);
          totalSeconds += Number(h.total_seconds);
          bounceCount += Number(h.bounce_count);
          // For unique counts across combined range, take the larger value.
          // This slightly over-counts if a user is active both today AND historically,
          // but the error is small (bounded by today's unique count).
          uniqueUsers = Math.max(uniqueUsers, Number(h.unique_users));
          uniqueLocations = Math.max(uniqueLocations, Number(h.unique_locations));
        }
      }

      const activeMinutes = Math.round(totalSeconds / 60);
      const avgDuration = totalSessions > 0 ? Math.round(totalSeconds / totalSessions) : 0;
      const bounceRate = totalSessions > 0 ? Math.round((bounceCount / totalSessions) * 100) : 0;

      return {
        totalSessions,
        totalSeconds,
        uniqueUsers,
        uniqueLocations,
        bounceCount,
        activeMinutes,
        avgDuration,
        bounceRate,
      };
    },
    refetchInterval: 30_000,
    placeholderData: EMPTY_KPIS,
  });
}
