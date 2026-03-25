-- =========================================================================================
-- MIGRATION: 014_tracker_session_summary.sql
-- PURPOSE: Create a daily summary table for tracker sessions to solve frontend query limits.
--          Includes an RPC for incremental rollups and a pg_cron schedule.
-- =========================================================================================

-- 1. Create the Summary Table
CREATE TABLE IF NOT EXISTS public.tracker_session_daily_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    location_id TEXT,
    user_id TEXT,
    date DATE NOT NULL,
    total_duration_seconds INTEGER DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    bounce_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Ensure we only have one summary row per user per location per day per tenant
    UNIQUE(tenant_id, location_id, user_id, date)
);

-- 2. Index for faster date range querying
CREATE INDEX IF NOT EXISTS idx_tracker_session_summary_date 
    ON public.tracker_session_daily_summary(date);
CREATE INDEX IF NOT EXISTS idx_tracker_session_summary_tenant_date 
    ON public.tracker_session_daily_summary(tenant_id, date);

-- 3. Enable RLS
ALTER TABLE public.tracker_session_daily_summary ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
CREATE POLICY "Users can view their tenant's tracker summaries"
    ON public.tracker_session_daily_summary FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
        )
    );

-- Add Service Role policy for the cron job to bypass RLS
CREATE POLICY "Service role can manage all tracker summaries"
    ON public.tracker_session_daily_summary FOR ALL
    USING (auth.role() = 'service_role');

-- 5. Updated_at Trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at_tracker_summary()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.tracker_session_daily_summary;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.tracker_session_daily_summary
    FOR EACH ROW
    EXECUTE FUNCTION handle_updated_at_tracker_summary();


-- 6. RPC: Upsert Daily Summaries
-- This function calculates the aggregates for a specific date and inserts/updates them.
CREATE OR REPLACE FUNCTION public.upsert_tracker_summary_for_date(p_target_date DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Needs to bypass RLS to read all sessions and write summaries
AS $$
BEGIN
    INSERT INTO public.tracker_session_daily_summary (
        tenant_id,
        location_id,
        user_id,
        date,
        total_duration_seconds,
        session_count,
        bounce_count
    )
    SELECT
        tenant_id,
        location_id,
        user_id,
        (started_at AT TIME ZONE 'UTC')::date AS date,
        SUM(COALESCE(duration_seconds, 0))::integer AS total_duration_seconds,
        COUNT(*)::integer AS session_count,
        COUNT(*) FILTER (WHERE COALESCE(duration_seconds, 0) < 10)::integer AS bounce_count
    FROM
        public.tracker_page_sessions
    WHERE
        tenant_id IS NOT NULL
        AND user_id IS NOT NULL 
        AND location_id IS NOT NULL
        AND (started_at AT TIME ZONE 'UTC')::date = p_target_date
    GROUP BY
        tenant_id,
        location_id,
        user_id,
        (started_at AT TIME ZONE 'UTC')::date
    ON CONFLICT (tenant_id, location_id, user_id, date) 
    DO UPDATE SET
        total_duration_seconds = EXCLUDED.total_duration_seconds,
        session_count = EXCLUDED.session_count,
        bounce_count = EXCLUDED.bounce_count,
        updated_at = timezone('utc'::text, now());
END;
$$;


-- 7. Initial Historical Backfill
-- Run the RPC for all distinct dates found in the raw table up to *yesterday*.
-- We don't summarize *today* because it's still actively accumulating.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT DISTINCT (started_at AT TIME ZONE 'UTC')::date AS ddate
        FROM public.tracker_page_sessions
        WHERE (started_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'UTC')::date
        ORDER BY ddate
    LOOP
        PERFORM public.upsert_tracker_summary_for_date(r.ddate);
    END LOOP;
END $$;


-- 8. Setup pg_cron Scheduled Job
-- NOTE: pg_cron extension requires Superuser privileges. In Supabase, you can enable it 
-- via the Dashboard (Database -> Extensions), and the postgres user can schedule jobs.
-- This creates a job named 'nightly_tracker_rollup' that runs at 01:00 AM UTC every day.
-- It summarizes the data for *yesterday* ('now() - interval 1 day').

-- Ensure the extension is loosely available if they have superuser rights enabled for this script
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA extensions;

-- Attempt to schedule the job. Use an exception block just in case the executing user lacks permissions.
DO $$
BEGIN
    -- Remove if it exists to allow re-running this migration safely
    PERFORM cron.unschedule('nightly_tracker_rollup');
    
    -- Schedule it
    PERFORM cron.schedule(
        'nightly_tracker_rollup',
        '0 1 * * *', -- 1:00 AM UTC every day
        'SELECT public.upsert_tracker_summary_for_date((now() - interval ''1 day'')::date);'
    );
EXCEPTION 
    WHEN OTHERS THEN
        RAISE NOTICE 'Failed to setup pg_cron job. Ensure pg_cron is enabled and the user has correct permissions. Error: %', SQLERRM;
END $$;
