import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './use-auth';
import { useFilters } from './use-filters';

export interface AdSpendRow {
  id: string;
  tenant_id: string;
  channel: string;
  period: string; // YYYY-MM-DD (first of month)
  amount: number;
  currency: string;
  notes: string | null;
}

export interface RoiRow {
  channel: string;
  spend: number;
  lead_count: number;
  converted_count: number;
  revenue: number;
  cpl: number;
  cpa: number;
  roi_pct: number;
}

const DEFAULT_CHANNELS = [
  'Facebook Ads',
  'Google Ads',
  'Instagram Ads',
  'TikTok Ads',
  'YouTube Ads',
  'LinkedIn Ads',
];

export { DEFAULT_CHANNELS };

/** Fetch all ad_spend rows for the current tenant */
export function useAdSpend() {
  const { tenant } = useAuth();

  return useQuery({
    queryKey: ['ad_spend', tenant?.id],
    enabled: !!tenant,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ad_spend')
        .select('*')
        .order('period', { ascending: false })
        .order('channel');

      if (error) throw error;
      return (data ?? []) as AdSpendRow[];
    },
  });
}

/** Upsert a spend row (insert or update by channel+period) */
export function useUpsertAdSpend() {
  const qc = useQueryClient();
  const { tenant } = useAuth();

  return useMutation({
    mutationFn: async (row: { channel: string; period: string; amount: number; notes?: string }) => {
      if (!tenant) throw new Error('No tenant');

      const { error } = await supabase
        .from('ad_spend')
        .upsert(
          {
            tenant_id: tenant.id,
            channel: row.channel,
            period: row.period,
            amount: row.amount,
            currency: 'BRL',
            notes: row.notes || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,channel,period' },
        );

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad_spend'] });
      qc.invalidateQueries({ queryKey: ['marketing_roi'] });
    },
  });
}

/** Delete a spend row */
export function useDeleteAdSpend() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ad_spend').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad_spend'] });
      qc.invalidateQueries({ queryKey: ['marketing_roi'] });
    },
  });
}

/** Get ROI calculations combining ad_spend + GHL conversion data */
export function useMarketingRoi() {
  const { tenant } = useAuth();
  const { dateRange } = useFilters();

  return useQuery({
    queryKey: ['marketing_roi', tenant?.id, dateRange.from, dateRange.to],
    enabled: !!tenant,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_marketing_roi', {
        p_start: dateRange.from,
        p_end: dateRange.to,
      });

      if (error) throw error;
      return (data ?? []) as RoiRow[];
    },
  });
}
