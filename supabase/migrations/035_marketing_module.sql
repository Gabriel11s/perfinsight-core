-- =================================================================
-- Marketing Module — RPCs for channel attribution, funnel, agent perf
-- All derived from existing ghl_events table
-- =================================================================

-- ─── 1. Channel Summary ─────────────────────────────────────────
-- Returns lead count, attended, converted, revenue per source channel
CREATE OR REPLACE FUNCTION public.get_marketing_channel_summary(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (
  channel         text,
  lead_count      bigint,
  attended_count  bigint,
  converted_count bigint,
  revenue         numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH my_tenant AS (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() LIMIT 1
  ),
  -- All contacts created in the period
  leads AS (
    SELECT
      e.contact_id,
      COALESCE(
        e.event_data->'contact'->>'source',
        e.event_data->>'source',
        'Unknown'
      ) AS channel,
      e.user_id AS assigned_agent
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type = 'ContactCreate'
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
  ),
  -- Contacts that received outbound activity (attended)
  attended AS (
    SELECT DISTINCT e.contact_id
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type IN ('OutboundMessage', 'AppointmentCreate')
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
  ),
  -- Contacts linked to won opportunities
  converted AS (
    SELECT DISTINCT
      e.contact_id,
      COALESCE(
        (e.event_data->'opportunity'->>'monetaryValue')::numeric,
        0
      ) AS deal_value
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type IN ('OpportunityStatusUpdate', 'OpportunityCreate')
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
      AND (
        LOWER(e.event_data->'opportunity'->>'status') = 'won'
        OR LOWER(e.event_data->>'status') = 'won'
      )
  )
  SELECT
    l.channel,
    COUNT(DISTINCT l.contact_id)                         AS lead_count,
    COUNT(DISTINCT CASE WHEN a.contact_id IS NOT NULL THEN l.contact_id END) AS attended_count,
    COUNT(DISTINCT CASE WHEN c.contact_id IS NOT NULL THEN l.contact_id END) AS converted_count,
    COALESCE(SUM(c.deal_value), 0)                       AS revenue
  FROM leads l
  LEFT JOIN attended a ON a.contact_id = l.contact_id
  LEFT JOIN converted c ON c.contact_id = l.contact_id
  GROUP BY l.channel
  ORDER BY lead_count DESC;
$$;

-- ─── 2. Agent Performance ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_marketing_agent_performance(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (
  user_id          text,
  leads_assigned   bigint,
  leads_attended   bigint,
  leads_converted  bigint,
  revenue          numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH my_tenant AS (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() LIMIT 1
  ),
  -- Contacts assigned to each agent
  agent_leads AS (
    SELECT
      e.user_id,
      e.contact_id
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type = 'ContactCreate'
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
      AND e.user_id IS NOT NULL
  ),
  -- Outbound activity per contact
  attended AS (
    SELECT DISTINCT e.contact_id
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type IN ('OutboundMessage', 'AppointmentCreate')
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
  ),
  -- Won opportunities per contact
  converted AS (
    SELECT DISTINCT
      e.contact_id,
      COALESCE(
        (e.event_data->'opportunity'->>'monetaryValue')::numeric,
        0
      ) AS deal_value
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type IN ('OpportunityStatusUpdate', 'OpportunityCreate')
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
      AND (
        LOWER(e.event_data->'opportunity'->>'status') = 'won'
        OR LOWER(e.event_data->>'status') = 'won'
      )
  )
  SELECT
    al.user_id,
    COUNT(DISTINCT al.contact_id)                          AS leads_assigned,
    COUNT(DISTINCT CASE WHEN a.contact_id IS NOT NULL THEN al.contact_id END) AS leads_attended,
    COUNT(DISTINCT CASE WHEN c.contact_id IS NOT NULL THEN al.contact_id END) AS leads_converted,
    COALESCE(SUM(c.deal_value), 0)                          AS revenue
  FROM agent_leads al
  LEFT JOIN attended a ON a.contact_id = al.contact_id
  LEFT JOIN converted c ON c.contact_id = al.contact_id
  GROUP BY al.user_id
  ORDER BY leads_assigned DESC;
$$;

-- ─── 3. Marketing Funnel ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_marketing_funnel(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (
  total_leads          bigint,
  leads_with_activity  bigint,
  leads_with_opportunity bigint,
  leads_won            bigint,
  total_revenue        numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH my_tenant AS (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() LIMIT 1
  ),
  leads AS (
    SELECT DISTINCT e.contact_id
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type = 'ContactCreate'
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
  ),
  with_activity AS (
    SELECT DISTINCT e.contact_id
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type IN ('OutboundMessage', 'AppointmentCreate', 'InboundMessage')
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
      AND e.contact_id IN (SELECT contact_id FROM leads)
  ),
  with_opp AS (
    SELECT DISTINCT e.contact_id
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type IN ('OpportunityCreate', 'OpportunityStatusUpdate')
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
      AND e.contact_id IN (SELECT contact_id FROM leads)
  ),
  won AS (
    SELECT DISTINCT
      e.contact_id,
      COALESCE(
        (e.event_data->'opportunity'->>'monetaryValue')::numeric,
        0
      ) AS deal_value
    FROM public.ghl_events e
    JOIN my_tenant t ON e.tenant_id = t.tenant_id
    WHERE e.event_type IN ('OpportunityStatusUpdate', 'OpportunityCreate')
      AND e.event_date >= p_start
      AND e.event_date < p_end
      AND e.contact_id IS NOT NULL
      AND e.contact_id IN (SELECT contact_id FROM leads)
      AND (
        LOWER(e.event_data->'opportunity'->>'status') = 'won'
        OR LOWER(e.event_data->>'status') = 'won'
      )
  )
  SELECT
    (SELECT COUNT(*) FROM leads)::bigint          AS total_leads,
    (SELECT COUNT(*) FROM with_activity)::bigint  AS leads_with_activity,
    (SELECT COUNT(*) FROM with_opp)::bigint       AS leads_with_opportunity,
    (SELECT COUNT(*) FROM won)::bigint            AS leads_won,
    COALESCE((SELECT SUM(deal_value) FROM won), 0) AS total_revenue;
$$;

-- ─── 4. Leads Timeline (daily by channel) ───────────────────────
CREATE OR REPLACE FUNCTION public.get_marketing_leads_timeline(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (
  day      date,
  channel  text,
  count    bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH my_tenant AS (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() LIMIT 1
  )
  SELECT
    (e.event_date AT TIME ZONE 'UTC')::date AS day,
    COALESCE(
      e.event_data->'contact'->>'source',
      e.event_data->>'source',
      'Unknown'
    ) AS channel,
    COUNT(*) AS count
  FROM public.ghl_events e
  JOIN my_tenant t ON e.tenant_id = t.tenant_id
  WHERE e.event_type = 'ContactCreate'
    AND e.event_date >= p_start
    AND e.event_date < p_end
    AND e.contact_id IS NOT NULL
  GROUP BY day, channel
  ORDER BY day ASC, count DESC;
$$;
