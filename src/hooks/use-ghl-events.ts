import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/hooks/use-filters';
import { useSettings } from '@/hooks/use-settings';
import { format } from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';

export interface GhlEventSummary {
  id?: string;
  tenant_id: string;
  location_id: string;
  event_date: string; // YYYY-MM-DD
  event_type: string;
  event_count: number;
  sms_count: number;
  call_count: number;
  email_count: number;
  other_msg_count: number;
  user_counts: Record<string, number>;
  created_at?: string;
}

export interface GhlEvent {
  id: string;
  location_id: string;
  event_type: string;
  user_id: string | null;
  contact_id: string | null;
  event_data: Record<string, any>;
  event_date: string;
  created_at: string;
}

/**
 * Fetches GHL event summaries within the current date range via server-side RPC.
 * Uses get_event_summary_totals() which aggregates in Postgres — no pagination cap.
 * Returns one row per event_type with totals (not per-date rows).
 *
 * Previously used a direct table query with .limit(2000) which was silently
 * capped to 1000 by PostgREST max_rows, causing underreported event counts.
 */
export function useGhlEvents(opts?: { userId?: string; locationId?: string }) {
  const { dateRange, timezone } = useFilters();

  const fromDate = formatInTimeZone(dateRange.from, timezone, 'yyyy-MM-dd');
  const toDate = formatInTimeZone(dateRange.to, timezone, 'yyyy-MM-dd');

  return useQuery({
    queryKey: [
      'ghl-event-summary',
      fromDate,
      toDate,
      opts?.userId || 'all',
      opts?.locationId || 'all',
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_event_summary_totals', {
        p_start_date: fromDate,
        p_end_date: toDate,
        p_user_id: opts?.userId ?? null,
        p_location_id: opts?.locationId ?? null,
      });
      if (error) throw error;

      // Map RPC rows into the GhlEventSummary shape that the rest of the app expects.
      // The RPC returns one row per event_type with aggregated counts.
      return ((data || []) as any[]).map(row => ({
        tenant_id: '',
        location_id: opts?.locationId || '',
        event_date: fromDate,
        event_type: row.event_type as string,
        event_count: Number(row.event_count),
        sms_count: Number(row.sms_count),
        call_count: Number(row.call_count),
        email_count: Number(row.email_count),
        other_msg_count: Number(row.other_msg_count),
        user_counts: {},
      })) as GhlEventSummary[];
    },
  });
}

/**
 * Returns only summaries that are enabled in settings.
 */
export function useEnabledGhlEvents(opts?: { userId?: string; locationId?: string }) {
  const { data: summaries = [], isLoading: summariesLoading, ...rest } = useGhlEvents(opts);
  const { data: settings, isLoading: settingsLoading } = useSettings();

  const enabledEvents = settings?.enabled_events || {};

  const filtered = summaries.filter(s => {
    // Always exclude INSTALL events (noise from GHL app install webhooks)
    if (s.event_type.toUpperCase().includes('INSTALL')) return false;
    // Exclude events explicitly disabled in settings; include if not mentioned (default-on)
    return enabledEvents[s.event_type] !== false;
  });

  return {
    data: filtered,
    allEvents: summaries,
    isLoading: summariesLoading || settingsLoading,
    enabledEvents,
    ...rest,
  };
}

/**
 * Fetches raw GHL events for today, filtered to only enabled event types.
 * Used for the hourly "Activity Over Time" chart — ghl_event_daily_summary only
 * has date-level granularity, so on the today/hourly view we need exact timestamps
 * from ghl_events directly (same dual-path strategy as useTrackerSessions).
 *
 * IMPORTANT: Filters disabled event types server-side so that high-volume disabled
 * events (InboundMessage, OutboundMessage) don't consume the 2000-row pagination cap
 * and crowd out the enabled events we actually need for the chart.
 *
 * Uses UTC date strings for filtering (not local midnight) because
 * ghl_event_daily_summary keys dates on UTC and ghl-webhook stores event_date
 * from GHL payload timestamps.
 */
export function useGhlRawEventsToday(opts?: { userId?: string; locationId?: string }) {
  const { dateRange, timezone } = useFilters();
  const { data: settings } = useSettings();
  const isToday = dateRange.to.getTime() - dateRange.from.getTime() < 86_400_000;

  const enabledEvents = settings?.enabled_events || {};
  // Event types to exclude: explicitly disabled in settings + INSTALL noise
  const disabledTypes = [
    ...Object.entries(enabledEvents).filter(([_, v]) => v === false).map(([k]) => k),
    'INSTALL',
  ];
  // Stable key for React Query (sort so order doesn't cause cache misses)
  const disabledKey = [...disabledTypes].sort().join(',');

  // "Today" in the user's configured timezone expressed as a UTC date string.
  // The ghl_event_daily_summary keys dates on UTC, but ghl_events.event_date is
  // a timestamptz — we filter with the dateRange boundaries (already timezone-aware)
  // for accurate results.
  const todayInTz = format(toZonedTime(new Date(), timezone), 'yyyy-MM-dd');

  return useQuery({
    queryKey: [
      'ghl-raw-events-today',
      todayInTz,
      opts?.userId || 'all',
      opts?.locationId || 'all',
      disabledKey,
    ],
    enabled: isToday,
    refetchInterval: 30000,
    queryFn: async () => {
      // Use the timezone-aware dateRange boundaries (from use-filters)
      // to query raw events. These are already UTC instants representing
      // the start/end of "today" in the user's configured timezone.
      const rangeStart = dateRange.from.toISOString();
      const rangeEnd = dateRange.to.toISOString();

      const buildQ = () => {
        let q = supabase
          .from('ghl_events')
          .select('id, location_id, event_type, event_date')
          .gte('event_date', rangeStart)
          .lte('event_date', rangeEnd)
          .order('event_date', { ascending: false });
        if (opts?.userId) q = q.eq('user_id', opts.userId);
        if (opts?.locationId) q = q.eq('location_id', opts.locationId);
        // Exclude disabled event types server-side to maximize useful rows within the 2000 cap
        if (disabledTypes.length > 0) {
          q = q.not('event_type', 'in', `(${disabledTypes.join(',')})`);
        }
        return q;
      };

      // Two paginated requests to bypass Supabase PostgREST max_rows=1000 cap
      const [res1, res2] = await Promise.all([
        buildQ().range(0, 999),
        buildQ().range(1000, 1999),
      ]);
      if (res1.error) throw res1.error;
      if (res2.error) throw res2.error;
      return [...(res1.data || []), ...(res2.data || [])] as Pick<GhlEvent, 'id' | 'location_id' | 'event_type' | 'event_date'>[];
    },
  });
}

/**
 * Fetches raw GHL events within the current date range (only for ActivityFeed).
 */
export function useGhlRawEvents(opts?: { userId?: string; locationId?: string }) {
  const { dateRange } = useFilters();

  return useQuery({
    queryKey: [
      'ghl-raw-events',
      dateRange.from.toISOString().slice(0, 10),
      dateRange.to.toISOString().slice(0, 10),
      opts?.userId || 'all',
      opts?.locationId || 'all',
    ],
    queryFn: async () => {
      let query = supabase
        .from('ghl_events')
        .select('id, location_id, event_type, user_id, contact_id, event_data, event_date, created_at')
        .gte('event_date', dateRange.from.toISOString())
        .lte('event_date', dateRange.to.toISOString())
        .order('event_date', { ascending: false })
        .limit(100);

      if (opts?.userId) {
        query = query.eq('user_id', opts.userId);
      }
      if (opts?.locationId) {
        query = query.eq('location_id', opts.locationId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as GhlEvent[];
    },
  });
}

/** Human-readable label for event types */
export const EVENT_LABELS: Record<string, string> = {
  AppointmentCreate: 'Appointment Created',
  AppointmentUpdate: 'Appointment Updated',
  AppointmentDelete: 'Appointment Deleted',
  ContactCreate: 'Contact Created',
  ContactUpdate: 'Contact Updated',
  ContactDelete: 'Contact Deleted',
  ContactDndUpdate: 'Contact DND Changed',
  ContactTagUpdate: 'Contact Tags Changed',
  ConversationUnreadUpdate: 'Conversation Unread',
  InboundMessage: 'Message Received',
  OutboundMessage: 'Message Sent',
  TaskCreate: 'Task Created',
  TaskComplete: 'Task Completed',
  TaskDelete: 'Task Deleted',
  OpportunityCreate: 'Opportunity Created',
  OpportunityUpdate: 'Opportunity Updated',
  OpportunityDelete: 'Opportunity Deleted',
  OpportunityStatusUpdate: 'Opportunity Status Changed',
  OpportunityStageUpdate: 'Opportunity Stage Changed',
  OpportunityMonetaryValueUpdate: 'Opportunity Value Changed',
  OpportunityAssignedToUpdate: 'Opportunity Reassigned',
  NoteCreate: 'Note Created',
  NoteUpdate: 'Note Updated',
  NoteDelete: 'Note Deleted',
  LocationCreate: 'Location Created',
  LocationUpdate: 'Location Updated',
};

/** Broader categories for pie chart display */
export const GROUPED_EVENT_LABELS: Record<string, string> = {
  Appointment: 'Appointments',
  Contact: 'Contacts',
  Conversation: 'Conversations',
  Inbound: 'Conversations',
  Outbound: 'Conversations',
  Task: 'Tasks',
  Opportunity: 'Opportunities',
  Note: 'Notes',
  Location: 'Locations',
};

/** Color for each event category */
export const EVENT_COLORS: Record<string, string> = {
  Appointment: 'text-blue-400 bg-blue-400/10',
  Contact: 'text-emerald-400 bg-emerald-400/10',
  Conversation: 'text-cyan-400 bg-cyan-400/10',
  Inbound: 'text-cyan-400 bg-cyan-400/10',
  Outbound: 'text-sky-400 bg-sky-400/10',
  Task: 'text-violet-400 bg-violet-400/10',
  Opportunity: 'text-amber-400 bg-amber-400/10',
  Note: 'text-pink-400 bg-pink-400/10',
  Location: 'text-orange-400 bg-orange-400/10',
};

export function getEventColor(eventType: string): string {
  for (const [prefix, color] of Object.entries(EVENT_COLORS)) {
    if (eventType.startsWith(prefix)) return color;
  }
  return 'text-muted-foreground bg-muted';
}

/**
 * Aggregate summaries into counts by event_type.
 * Note: input is now GhlEventSummary[]
 */
export function aggregateEventCounts(summaries: GhlEventSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  summaries.forEach(s => {
    counts[s.event_type] = (counts[s.event_type] || 0) + s.event_count;
  });
  return counts;
}

/**
 * Aggregates events into broad topics for the pie chart.
 * Automatically excludes 'Install' events.
 */
export function aggregateEventsByTopic(summaries: GhlEventSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  
  summaries.forEach(s => {
    // Explicitly ignore any Install events
    if (s.event_type.toLowerCase().includes('install')) {
      return;
    }

    // Determine the broad topic grouping
    let topic = 'Other';
    for (const [prefix, groupedName] of Object.entries(GROUPED_EVENT_LABELS)) {
      if (s.event_type.startsWith(prefix)) {
        topic = groupedName;
        break;
      }
    }

    counts[topic] = (counts[topic] || 0) + s.event_count;
  });

  return counts;
}
