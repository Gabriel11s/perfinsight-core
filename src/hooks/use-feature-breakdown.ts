import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/hooks/use-filters';

export interface FeatureItem {
  name: string;
  minutes: number;
  sessions: number;
}

/**
 * Server-side feature (page category) breakdown via RPC.
 *
 * Calls `get_feature_breakdown` which aggregates directly from raw
 * tracker_page_sessions using the expanded `categorize_page_path()` function.
 * Bypasses the 2000-row pagination cap — always accurate.
 */
export function useFeatureBreakdown(opts?: { userId?: string; locationId?: string }) {
  const { dateRange } = useFilters();

  return useQuery({
    queryKey: [
      'feature-breakdown',
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      opts?.userId || 'all',
      opts?.locationId || 'all',
    ],
    queryFn: async (): Promise<FeatureItem[]> => {
      const res = await supabase.rpc('get_feature_breakdown', {
        p_start: dateRange.from.toISOString(),
        p_end: dateRange.to.toISOString(),
        p_user_id: opts?.userId ?? null,
        p_location_id: opts?.locationId ?? null,
      });
      if (res.error) throw res.error;
      return ((res.data || []) as any[]).map(r => ({
        name: r.category,
        minutes: Number(r.total_minutes),
        sessions: Number(r.session_count),
      }));
    },
    refetchInterval: 30_000,
  });
}
