import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  SUPABASE_URL,
  GHL_CLIENT_ID,
  GHL_MARKETPLACE_URL,
  GHL_SCOPES,
} from '@/lib/constants';

export function useGhlConnection() {
  const { tenant } = useAuth();

  return useQuery({
    queryKey: ['ghl-connection', tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ghl_oauth_tokens')
        .select('tenant_id, expires_at, location_id, updated_at')
        .eq('tenant_id', tenant!.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return { connected: false as const };

      const isExpired = new Date(data.expires_at) < new Date();
      return {
        connected: true as const,
        locationId: data.location_id,
        expiresAt: data.expires_at,
        updatedAt: data.updated_at,
        isExpired,
      };
    },
    staleTime: 30_000,
  });
}

export function getGhlConnectUrl(tenantId: string, redirectUrl: string) {
  const redirectUri = encodeURIComponent(
    `${SUPABASE_URL}/functions/v1/integration-callback`,
  );
  const state = btoa(
    JSON.stringify({ tenant_id: tenantId, redirect_url: redirectUrl }),
  );
  return `${GHL_MARKETPLACE_URL}?response_type=code&redirect_uri=${redirectUri}&client_id=${GHL_CLIENT_ID}&scope=${encodeURIComponent(GHL_SCOPES)}&state=${encodeURIComponent(state)}`;
}
