import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/hooks/use-filters';

export interface ChannelSummary {
  channel: string;
  lead_count: number;
  attended_count: number;
  converted_count: number;
  revenue: number;
}

export interface AgentPerformance {
  user_id: string;
  leads_assigned: number;
  leads_attended: number;
  leads_converted: number;
  revenue: number;
}

export interface MarketingFunnel {
  total_leads: number;
  leads_with_activity: number;
  leads_with_opportunity: number;
  leads_won: number;
  total_revenue: number;
}

export interface LeadsTimelineRow {
  day: string;
  channel: string;
  count: number;
}

export function useMarketingChannels() {
  const { dateRange } = useFilters();

  return useQuery({
    queryKey: ['marketing-channels', dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_marketing_channel_summary', {
        p_start: dateRange.from.toISOString(),
        p_end: dateRange.to.toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as ChannelSummary[];
    },
  });
}

export function useMarketingAgents() {
  const { dateRange } = useFilters();

  return useQuery({
    queryKey: ['marketing-agents', dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_marketing_agent_performance', {
        p_start: dateRange.from.toISOString(),
        p_end: dateRange.to.toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as AgentPerformance[];
    },
  });
}

export function useMarketingFunnel() {
  const { dateRange } = useFilters();

  return useQuery({
    queryKey: ['marketing-funnel', dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_marketing_funnel', {
        p_start: dateRange.from.toISOString(),
        p_end: dateRange.to.toISOString(),
      });
      if (error) throw error;
      const row = (data as MarketingFunnel[] | null)?.[0];
      return row ?? { total_leads: 0, leads_with_activity: 0, leads_with_opportunity: 0, leads_won: 0, total_revenue: 0 };
    },
  });
}

export function useMarketingTimeline() {
  const { dateRange } = useFilters();

  return useQuery({
    queryKey: ['marketing-timeline', dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_marketing_leads_timeline', {
        p_start: dateRange.from.toISOString(),
        p_end: dateRange.to.toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as LeadsTimelineRow[];
    },
  });
}
