-- =================================================================
-- Ad Spend — Manual input of advertising investment per channel/month
-- Used for ROI, CPL, CPA calculations in the Marketing module
-- =================================================================

CREATE TABLE IF NOT EXISTS public.ad_spend (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel     text NOT NULL,               -- e.g. 'Facebook Ads', 'Google Ads'
  period      date NOT NULL,               -- First day of month (2026-03-01)
  amount      numeric(12,2) NOT NULL DEFAULT 0,
  currency    text NOT NULL DEFAULT 'BRL',
  notes       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),

  UNIQUE (tenant_id, channel, period)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ad_spend_tenant_period
  ON public.ad_spend(tenant_id, period DESC);

-- RLS
ALTER TABLE public.ad_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select_ad_spend" ON public.ad_spend;
CREATE POLICY "tenant_select_ad_spend" ON public.ad_spend
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "tenant_insert_ad_spend" ON public.ad_spend;
CREATE POLICY "tenant_insert_ad_spend" ON public.ad_spend
  FOR INSERT TO authenticated WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "tenant_update_ad_spend" ON public.ad_spend;
CREATE POLICY "tenant_update_ad_spend" ON public.ad_spend
  FOR UPDATE TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "tenant_delete_ad_spend" ON public.ad_spend;
CREATE POLICY "tenant_delete_ad_spend" ON public.ad_spend
  FOR DELETE TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid())
  );

-- ─── RPC: Get marketing ROI summary (combines ad_spend + conversions) ───
CREATE OR REPLACE FUNCTION public.get_marketing_roi(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (
  channel          text,
  spend            numeric,
  lead_count       bigint,
  converted_count  bigint,
  revenue          numeric,
  cpl              numeric,  -- Cost Per Lead
  cpa              numeric,  -- Cost Per Acquisition
  roi_pct          numeric   -- Return on Investment %
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH my_tenant AS (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() LIMIT 1
  ),
  -- Ad spend aggregated by channel for the period
  spend AS (
    SELECT
      s.channel,
      SUM(s.amount) AS total_spend
    FROM public.ad_spend s
    JOIN my_tenant t ON s.tenant_id = t.tenant_id
    WHERE s.period >= (p_start::date)
      AND s.period < (p_end::date + interval '1 month')
    GROUP BY s.channel
  ),
  -- Leads per channel (from ContactCreate events)
  leads AS (
    SELECT
      COALESCE(
        e.event_data->'contact'->>'source',
        e.event_data->>'source',
        'Unknown'
      ) AS channel,
      COUNT(DISTINCT e.contact_id) AS lead_count
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type = 'ContactCreate'
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
    GROUP BY channel
  ),
  -- Conversions per channel
  conversions AS (
    SELECT
      COALESCE(
        cc.event_data->'contact'->>'source',
        cc.event_data->>'source',
        'Unknown'
      ) AS channel,
      COUNT(DISTINCT opp.contact_id) AS converted_count,
      COALESCE(SUM(
        (opp.event_data->'opportunity'->>'monetaryValue')::numeric
      ), 0) AS revenue
    FROM public.ghl_events opp
    JOIN my_tenant t ON opp.tenant_id = t.tenant_id
    -- Join back to the contact's create event to get channel
    LEFT JOIN public.ghl_events cc
      ON cc.contact_id = opp.contact_id
      AND cc.event_type = 'ContactCreate'
      AND cc.tenant_id = opp.tenant_id
    WHERE opp.event_type IN ('OpportunityStatusUpdate', 'OpportunityCreate')
      AND opp.event_date >= p_start
      AND opp.event_date < p_end
      AND opp.contact_id IS NOT NULL
      AND (
        LOWER(opp.event_data->'opportunity'->>'status') = 'won'
        OR LOWER(opp.event_data->>'status') = 'won'
      )
    GROUP BY channel
  ),
  -- Combine all channels (union of spend + leads + conversions)
  all_channels AS (
    SELECT channel FROM spend
    UNION
    SELECT channel FROM leads
    UNION
    SELECT channel FROM conversions
  )
  SELECT
    ac.channel,
    COALESCE(s.total_spend, 0) AS spend,
    COALESCE(l.lead_count, 0) AS lead_count,
    COALESCE(c.converted_count, 0) AS converted_count,
    COALESCE(c.revenue, 0) AS revenue,
    CASE WHEN COALESCE(l.lead_count, 0) > 0
      THEN ROUND(COALESCE(s.total_spend, 0) / l.lead_count, 2)
      ELSE 0
    END AS cpl,
    CASE WHEN COALESCE(c.converted_count, 0) > 0
      THEN ROUND(COALESCE(s.total_spend, 0) / c.converted_count, 2)
      ELSE 0
    END AS cpa,
    CASE WHEN COALESCE(s.total_spend, 0) > 0
      THEN ROUND(((COALESCE(c.revenue, 0) - COALESCE(s.total_spend, 0)) / COALESCE(s.total_spend, 0)) * 100, 1)
      ELSE 0
    END AS roi_pct
  FROM all_channels ac
  LEFT JOIN spend s ON s.channel = ac.channel
  LEFT JOIN leads l ON l.channel = ac.channel
  LEFT JOIN conversions c ON c.channel = ac.channel
  ORDER BY COALESCE(s.total_spend, 0) DESC;
$$;
