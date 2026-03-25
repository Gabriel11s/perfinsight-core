import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';

export interface PipelineStatus {
  cached_locations: number;
  cached_users: number;
  orphaned_sessions: number;
  orphaned_events: number;
  sessions_24h: number;
  events_24h: number;
  active_users_24h: number;
  active_locations_24h: number;
  last_session_at: string | null;
  last_event_at: string | null;
}

export function usePipelineStatus() {
  const { tenant } = useAuth();
  return useQuery({
    queryKey: ['pipeline-status', tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pipeline_status', {
        p_tenant_id: tenant!.id,
      });
      if (error) throw error;
      return data as PipelineStatus;
    },
  });
}
