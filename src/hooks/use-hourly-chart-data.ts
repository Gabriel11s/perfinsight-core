import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/hooks/use-filters';
import { useSettings } from '@/hooks/use-settings';
import { eachDayOfInterval, eachHourOfInterval } from 'date-fns';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';

export interface ChartDataPoint {
  label: string;
  fullLabel: string;
  minutes: number;
  events: number;
}

export interface HourlySessionRow {
  hour_bucket: string;
  total_minutes: number;
  session_count: number;
}

interface HourlyEventRow {
  hour_bucket: string;
  event_count: number;
}

interface DailyEventRow {
  event_date: string;
  event_count: number;
}

/**
 * Computes the list of event types to exclude from charts/counts.
 * Mirrors the exact same logic as useEnabledGhlEvents:
 *   1. Any type containing "INSTALL" (handled server-side in the RPCs)
 *   2. Any type where settings.enabled_events[type] === false
 *
 * Returns a stable sorted array for use as a React Query key and RPC param.
 */
function useExcludedEventTypes(): string[] {
  const { data: settings } = useSettings();
  const enabledEvents = settings?.enabled_events || {};
  // Only types explicitly set to false — default (unmentioned) = enabled
  return Object.entries(enabledEvents)
    .filter(([_, v]) => v === false)
    .map(([k]) => k)
    .sort();
}

/**
 * Fetches hourly session aggregates via server-side RPC.
 * Bypasses the 2000-row pagination cap that caused morning data to be dropped.
 */
export function useHourlySessionData(opts?: { userId?: string; locationId?: string }) {
  const { dateRange } = useFilters();

  return useQuery({
    queryKey: [
      'hourly-sessions',
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      opts?.userId || 'all',
      opts?.locationId || 'all',
    ],
    queryFn: async (): Promise<HourlySessionRow[]> => {
      const res = await supabase.rpc('get_hourly_tracker_aggregates', {
        p_start: dateRange.from.toISOString(),
        p_end: dateRange.to.toISOString(),
        p_user_id: opts?.userId ?? null,
        p_location_id: opts?.locationId ?? null,
      });
      if (res.error) throw res.error;
      return ((res.data || []) as any[]).map(r => ({
        hour_bucket: r.hour_bucket,
        total_minutes: Number(r.total_minutes),
        session_count: Number(r.session_count),
      }));
    },
    refetchInterval: 30_000,
  });
}

/**
 * Fetches per-hour event counts via server-side RPC (get_hourly_event_counts).
 * Aggregates in Postgres — no row cap.
 * Uses the same INSTALL + disabled-type exclusions as the KPI path.
 *
 * CRITICAL: Uses timezone-formatted date strings (yyyy-MM-dd) for filtering,
 * matching the exact same date boundary as get_event_summary_totals (KPI) and
 * get_daily_event_counts (daily chart). This guarantees the hourly bar totals
 * sum to the same number as the GHL Events KPI.
 */
export function useHourlyEventCounts(opts?: { userId?: string; locationId?: string }) {
  const { dateRange, timezone } = useFilters();
  const excludedTypes = useExcludedEventTypes();
  const excludedKey = excludedTypes.join(',');

  // Same date format as KPI path (useGhlEvents)
  const fromDate = formatInTimeZone(dateRange.from, timezone, 'yyyy-MM-dd');
  const toDate = formatInTimeZone(dateRange.to, timezone, 'yyyy-MM-dd');

  return useQuery({
    queryKey: [
      'hourly-event-counts',
      fromDate,
      toDate,
      opts?.userId || 'all',
      opts?.locationId || 'all',
      excludedKey,
    ],
    queryFn: async (): Promise<HourlyEventRow[]> => {
      const { data, error } = await supabase.rpc('get_hourly_event_counts', {
        p_start_date: fromDate,
        p_end_date: toDate,
        p_user_id: opts?.userId ?? null,
        p_location_id: opts?.locationId ?? null,
        p_excluded_types: excludedTypes,
      });
      if (error) throw error;
      return ((data || []) as any[]).map(r => ({
        hour_bucket: r.hour_bucket,
        event_count: Number(r.event_count),
      }));
    },
    refetchInterval: 30_000,
  });
}

/**
 * Pure function: merges hourly session RPC data + hourly event RPC data into
 * chart-ready DataPoint[]. Used for the "today" hourly view.
 *
 * @param sessionRows    — from useHourlySessionData (RPC, accurate, no cap)
 * @param eventRows      — from useHourlyEventCounts (RPC, accurate, no cap)
 * @param dateRange      — timezone-aware UTC boundaries from useFilters
 * @param timezone       — user's configured timezone string
 * @param kpiEventTotal  — the exact event total from useEnabledGhlEvents (KPI).
 *   Because the KPI counts by UTC date but the chart shows local timezone hours,
 *   some events at UTC-day boundaries may not map to a visible chart slot.
 *   When provided, the hourly distribution is scaled proportionally so that
 *   sum(chart_bars) === kpiEventTotal — guaranteeing the chart matches the KPI.
 */
export function buildHourlyChartData(
  sessionRows: HourlySessionRow[],
  eventRows: HourlyEventRow[],
  dateRange: { from: Date; to: Date },
  timezone: string,
  kpiEventTotal?: number,
): ChartDataPoint[] {
  const fmt = (d: Date, f: string) => formatInTimeZone(d, timezone, f);

  // Generate 24 hourly intervals in the user's configured timezone
  const startInTz = toZonedTime(dateRange.from, timezone);
  const endInTz = toZonedTime(dateRange.to, timezone);
  const intervals = eachHourOfInterval({ start: startInTz, end: endInTz })
    .map(d => fromZonedTime(d, timezone));

  // Map session RPC rows by timezone-formatted key
  const sessionMap = new Map<string, number>();
  for (const r of sessionRows) {
    const key = fmt(new Date(r.hour_bucket), 'yyyy-MM-dd HH');
    sessionMap.set(key, r.total_minutes);
  }

  // Map hourly event RPC rows by timezone-formatted key
  const eventMap = new Map<string, number>();
  for (const r of eventRows) {
    const key = fmt(new Date(r.hour_bucket), 'yyyy-MM-dd HH');
    eventMap.set(key, (eventMap.get(key) || 0) + Number(r.event_count));
  }

  const result = intervals.map(date => {
    const key = fmt(date, 'yyyy-MM-dd HH');
    return {
      label: fmt(date, 'h a'),
      fullLabel: `${fmt(date, 'h:00 a')} - ${fmt(date, 'h:59 a')}`,
      minutes: sessionMap.get(key) || 0,
      events: eventMap.get(key) || 0,
    };
  });

  // Scale hourly event distribution to match the KPI total exactly.
  // The RPC counts by UTC date but the chart shows local timezone hours, so
  // events near UTC-day boundaries may not map to a visible slot. Scaling
  // preserves the hourly shape while ensuring the sum matches the KPI.
  if (kpiEventTotal !== undefined && kpiEventTotal > 0) {
    const rawTotal = result.reduce((sum, d) => sum + d.events, 0);
    if (rawTotal > 0 && rawTotal !== kpiEventTotal) {
      const scale = kpiEventTotal / rawTotal;
      result.forEach(d => {
        d.events = Math.round(d.events * scale);
      });
      // Fix rounding error: adjust the largest bar so sum is exact
      const scaledTotal = result.reduce((sum, d) => sum + d.events, 0);
      const diff = kpiEventTotal - scaledTotal;
      if (diff !== 0) {
        const maxIdx = result.reduce((mi, d, i, arr) => d.events > arr[mi].events ? i : mi, 0);
        result[maxIdx].events += diff;
      }
    } else if (rawTotal === 0 && kpiEventTotal > 0) {
      // RPC returned no hourly data but KPI has events — put all in a placeholder
      // This can happen if events are entirely outside visible timezone hours
      const now = new Date();
      const currentKey = fmt(now, 'yyyy-MM-dd HH');
      const idx = result.findIndex(d => fmt(intervals[result.indexOf(d)], 'yyyy-MM-dd HH') === currentKey);
      if (idx >= 0) result[idx].events = kpiEventTotal;
      else if (result.length > 0) result[0].events = kpiEventTotal;
    }
  }

  return result;
}

/**
 * Fetches daily activity chart data for multi-day views (7d, 30d).
 *
 * Session minutes: from get_daily_activity_chart RPC (tracker_session_daily_summary).
 * Event counts: from get_daily_event_counts RPC (ghl_event_daily_summary).
 *
 * CRITICAL: Event dates use timezone-formatted strings (yyyy-MM-dd) — the SAME
 * format as get_event_summary_totals (which powers the GHL Events KPI).
 * This guarantees sum(chart_event_bars) === KPI_event_total.
 */
export function useDailyActivityChart(opts?: { userId?: string; locationId?: string }) {
  const { dateRange, timezone } = useFilters();
  const excludedTypes = useExcludedEventTypes();
  const excludedKey = excludedTypes.join(',');

  // Timezone-formatted date strings — same as useGhlEvents KPI path
  const fromDate = formatInTimeZone(dateRange.from, timezone, 'yyyy-MM-dd');
  const toDate = formatInTimeZone(dateRange.to, timezone, 'yyyy-MM-dd');

  return useQuery({
    queryKey: [
      'daily-activity-chart',
      fromDate,
      toDate,
      opts?.userId || 'all',
      opts?.locationId || 'all',
      excludedKey,
    ],
    queryFn: async (): Promise<ChartDataPoint[]> => {
      const fmt = (d: Date, f: string) => formatInTimeZone(d, timezone, f);

      const startInTz = toZonedTime(dateRange.from, timezone);
      const endInTz = toZonedTime(dateRange.to, timezone);
      const intervals = eachDayOfInterval({ start: startInTz, end: endInTz })
        .map(d => fromZonedTime(d, timezone));

      // Initialize map with all expected dates
      const timeMap = new Map<string, { minutes: number; events: number; date: Date }>();
      intervals.forEach(d => {
        const key = fmt(d, 'yyyy-MM-dd');
        timeMap.set(key, { minutes: 0, events: 0, date: d });
      });

      // Fetch session minutes and event counts in parallel
      const [sessionRes, eventRes] = await Promise.all([
        // Session minutes from get_daily_activity_chart RPC
        supabase.rpc('get_daily_activity_chart', {
          p_start: dateRange.from.toISOString(),
          p_end: dateRange.to.toISOString(),
          p_user_id: opts?.userId ?? null,
          p_location_id: opts?.locationId ?? null,
          p_excluded_types: excludedTypes,
        }),
        // Event counts from get_daily_event_counts RPC
        // Uses timezone-formatted date strings (same as KPI path)
        supabase.rpc('get_daily_event_counts', {
          p_start_date: fromDate,
          p_end_date: toDate,
          p_user_id: opts?.userId ?? null,
          p_location_id: opts?.locationId ?? null,
          p_excluded_types: excludedTypes,
        }),
      ]);

      if (sessionRes.error) throw sessionRes.error;
      if (eventRes.error) throw eventRes.error;

      // Apply session minutes
      for (const row of (sessionRes.data || []) as any[]) {
        const key = row.date as string;
        const entry = timeMap.get(key);
        if (entry) {
          entry.minutes += Number(row.total_minutes);
        }
      }

      // Apply event counts (from same source/format as KPI)
      for (const row of (eventRes.data || []) as DailyEventRow[]) {
        const key = row.event_date as string;
        const entry = timeMap.get(key);
        if (entry) {
          entry.events += Number(row.event_count);
        }
      }

      return Array.from(timeMap.values()).map(({ date, minutes, events }) => ({
        label: fmt(date, 'MMM dd'),
        fullLabel: fmt(date, 'MMM dd, yyyy'),
        minutes,
        events,
      }));
    },
    refetchInterval: 30_000,
  });
}
