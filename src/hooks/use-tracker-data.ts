import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/hooks/use-filters';
import { syncGhlNames } from '@/lib/sync-ghl';
import { startOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const UNKNOWN_USER_SENTINEL = 'Unknown User';

export interface SessionRow {
  id: string;
  location_id: string;
  user_id: string;
  page_path: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  is_summary?: boolean;
  session_count?: number;
  bounce_count?: number;
}

interface SummaryRow {
  id: string;
  tenant_id: string;
  location_id: string;
  user_id: string;
  date: string;
  page_category: string;
  session_count: number;
  bounce_count: number;
  total_duration_seconds: number;
  created_at: string;
}

interface CacheNameRow {
  type: string;
  id: string;
  name: string | null;
}

export function useTrackerSessions(opts?: { userId?: string; locationId?: string }) {
  const { dateRange, timezone } = useFilters();

  const queryResult = useQuery({
    queryKey: ['tracker-sessions', dateRange.from.toISOString(), dateRange.to.toISOString(), opts?.userId, opts?.locationId],
    queryFn: async () => {
      // "Today start" in the user's configured timezone
      const nowInTz = toZonedTime(new Date(), timezone);
      const todayStart = fromZonedTime(startOfDay(nowInTz), timezone);
      const isHistorical = dateRange.from < todayStart;

      let rawData: SessionRow[] = [];
      let summaryData: SummaryRow[] = [];

      // 1. Fetch Today's Raw Data (always need this for real-time tracking)
      // Two paginated queries to bypass Supabase PostgREST's default max_rows=1000 cap.
      const rawQueryStart = dateRange.from > todayStart ? dateRange.from : todayStart;
      const buildRawQuery = () => {
        let q = supabase
          .from('tracker_page_sessions')
          .select('*')
          .gte('started_at', rawQueryStart.toISOString())
          .lte('started_at', dateRange.to.toISOString())
          .order('started_at', { ascending: false });
        if (opts?.userId) q = q.eq('user_id', opts.userId);
        if (opts?.locationId) q = q.eq('location_id', opts.locationId);
        return q;
      };

      // 2. Fetch Historical Summary Data (if range is before today)
      if (isHistorical) {
        let sumQuery = supabase
          .from('tracker_session_daily_summary')
          .select('*')
          .gte('date', dateRange.from.toISOString().split('T')[0])
          // Don't pull today's summary just in case the cron ran early
          .lt('date', todayStart.toISOString().split('T')[0]); 

        if (opts?.userId) sumQuery = sumQuery.eq('user_id', opts.userId);
        if (opts?.locationId) sumQuery = sumQuery.eq('location_id', opts.locationId);

        const [rawRes1, rawRes2, sumRes] = await Promise.all([
          buildRawQuery().range(0, 999),
          buildRawQuery().range(1000, 1999),
          sumQuery,
        ]);
        if (rawRes1.error) throw rawRes1.error;
        if (rawRes2.error) throw rawRes2.error;
        if (sumRes.error) throw sumRes.error;

        rawData = [...(rawRes1.data || []), ...(rawRes2.data || [])];
        summaryData = sumRes.data || [];
      } else {
        const [rawRes1, rawRes2] = await Promise.all([
          buildRawQuery().range(0, 999),
          buildRawQuery().range(1000, 1999),
        ]);
        if (rawRes1.error) throw rawRes1.error;
        if (rawRes2.error) throw rawRes2.error;
        rawData = [...(rawRes1.data || []), ...(rawRes2.data || [])];
      }

      // 3. Blend the data
      // For summary rows, we mock a SessionRow so the existing UI math (reduce duration) still works.
      // page_path is set to a canonical path for the stored page_category so that
      // categorizePagePath() in helpers.ts resolves it correctly — preserving Feature Usage
      // breakdowns on 7d/30d historical views.
      const CATEGORY_TO_PATH: Record<string, string> = {
        'Dashboard':     '/dashboard',
        'Conversations': '/conversations',
        'Contacts':      '/contacts',
        'Opportunities': '/opportunities',
        'Calendars':     '/calendars',
        'Automations':   '/automation',
        'Reporting':     '/reporting',
        'Settings':      '/settings',
        'Marketing':     '/marketing',
        'Media':         '/media',
        'Other':         '/other-history',
      };

      const mockSessionsFromSummary: SessionRow[] = summaryData.map(sum => ({
        id: `summary-${sum.id}`,
        location_id: sum.location_id,
        user_id: sum.user_id,
        page_path: CATEGORY_TO_PATH[sum.page_category] ?? '/other-history',
        started_at: `${sum.date}T12:00:00Z`,
        ended_at: `${sum.date}T12:00:00Z`,
        duration_seconds: sum.total_duration_seconds,
        is_summary: true,
        session_count: sum.session_count,
        bounce_count: sum.bounce_count
      }));

      return [...rawData, ...mockSessionsFromSummary] as SessionRow[];
    },
    refetchInterval: 30000,
  });

  const { data: userNames } = useGhlUserNames();
  const { data: locationNames } = useGhlLocationNames();
  const isSyncing = useRef(false);
  const queryClient = useQueryClient();

  // Background Auto-Sync for missing Names
  useEffect(() => {
    if (!queryResult.data || !userNames || !locationNames) return;
    if (isSyncing.current) return;

    let hasMissingResource = false;
    for (const session of queryResult.data) {
      if (session.user_id && !userNames.has(session.user_id)) {
        hasMissingResource = true;
        break;
      }
      if (session.location_id && !locationNames.has(session.location_id)) {
        hasMissingResource = true;
        break;
      }
    }

    if (hasMissingResource) {
      isSyncing.current = true;
      syncGhlNames(false).then(() => {
        // Force UI labels to rerender against the new data cache
        queryClient.invalidateQueries({ queryKey: ['cache-names'] });
      }).finally(() => {
        isSyncing.current = false;
      });
    }
  }, [queryResult.data, userNames, locationNames, queryClient]);

  // Filter out sessions with no user identity or confirmed-unresolvable users.
  // - null/empty user_id: tracker script couldn't extract a GHL user (rare edge case)
  // - "Unknown User" cached name: GHL API confirmed the user is not resolvable via
  //   this tenant's token (cross-company user or deleted). Hidden, retried every 7 days.
  // Wait for userNames to load before filtering to avoid flickering.
  const filteredData = useMemo(() => {
    const sessions = queryResult.data;
    if (!sessions) return sessions;
    // If cache hasn't loaded yet, show all sessions (avoids flash of empty state)
    if (!userNames) return sessions;
    return sessions.filter((s) => {
      if (!s.user_id) return false;
      return userNames.get(s.user_id) !== UNKNOWN_USER_SENTINEL;
    });
  }, [queryResult.data, userNames]);

  return { ...queryResult, data: filteredData };
}

/**
 * Shared RPC call that fetches ALL cached names (locations + users) in one query.
 * Uses get_cache_names() RPC which bypasses PostgREST max_rows=1000 cap.
 * Previously, direct table queries were silently capped at 1000 rows each.
 */
function useCacheNames() {
  return useQuery({
    queryKey: ['cache-names'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cache_names');
      if (error) throw error;

      const locationMap = new Map<string, string>();
      const userMap = new Map<string, string>();

      for (const row of (data || []) as CacheNameRow[]) {
        if (row.type === 'location') {
          locationMap.set(row.id, row.name || row.id);
        } else if (row.type === 'user') {
          userMap.set(row.id, row.name || row.id);
        }
      }

      return { locationMap, userMap };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useGhlLocationNames() {
  const { data, ...rest } = useCacheNames();
  return { data: data?.locationMap, ...rest };
}

export function useGhlUserNames() {
  const { data, ...rest } = useCacheNames();
  return { data: data?.userMap, ...rest };
}
