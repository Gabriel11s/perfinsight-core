import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Settings } from '@/types';

export function useSettings() {
  const { tenant } = useAuth();
  return useQuery({
    queryKey: ['settings', tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Settings | null;
    },
  });
}

export function useUpdateSettings() {
  const { tenant } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<Settings>) => {
      if (!tenant?.id) throw new Error('No tenant');
      const { error } = await supabase
        .from('settings')
        .upsert({
          tenant_id: tenant.id,
          ...updates,
          updated_at: new Date().toISOString(),
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
