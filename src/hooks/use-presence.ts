import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PresenceRow {
  user_id: string;
  location_id: string;
  page_path: string | null;
  last_seen_at: string;
}

/**
 * Polls the user_presence table every 15 seconds.
 * Returns all currently-online users (last_seen_at within 2 minutes).
 * RLS filters to the authenticated user's tenant automatically.
 */
export function usePresence(opts?: { locationId?: string }) {
  return useQuery({
    queryKey: ['user-presence', opts?.locationId],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      let q = supabase
        .from('user_presence')
        .select('user_id, location_id, page_path, last_seen_at')
        .gte('last_seen_at', cutoff);

      if (opts?.locationId) {
        q = q.eq('location_id', opts.locationId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PresenceRow[];
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

/**
 * Convenience wrapper returning derived presence data:
 * - onlineUserIds: Set for O(1) lookup
 * - onlineCount: number for KPI display
 * - userPages: Map from user_id to current page_path
 */
export function useOnlineUsers(opts?: { locationId?: string }) {
  const { data: presence = [], ...rest } = usePresence(opts);

  // Deduplicate by user_id — multi-tenant replication can produce duplicate rows
  // when a location is shared by multiple tenants and the user belongs to both.
  const dedupedByUser = new Map<string, PresenceRow>();
  presence.forEach(p => {
    // Keep the most recent entry per user_id
    const existing = dedupedByUser.get(p.user_id);
    if (!existing || p.last_seen_at > existing.last_seen_at) {
      dedupedByUser.set(p.user_id, p);
    }
  });

  const uniquePresence = Array.from(dedupedByUser.values());
  const onlineUserIds = new Set(uniquePresence.map(p => p.user_id));
  const onlineCount = onlineUserIds.size;

  const userPages = new Map<string, string | null>();
  uniquePresence.forEach(p => userPages.set(p.user_id, p.page_path));

  // Group by location — count unique users per location
  const locationUsers = new Map<string, Set<string>>();
  uniquePresence.forEach(p => {
    if (!locationUsers.has(p.location_id)) locationUsers.set(p.location_id, new Set());
    locationUsers.get(p.location_id)!.add(p.user_id);
  });
  const onlineByLocation = new Map<string, number>();
  locationUsers.forEach((users, locId) => onlineByLocation.set(locId, users.size));

  return {
    ...rest,
    data: uniquePresence,
    onlineUserIds,
    onlineCount,
    userPages,
    onlineByLocation,
  };
}
