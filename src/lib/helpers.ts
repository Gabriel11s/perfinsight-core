import { BOUNCE_THRESHOLD_SECONDS } from '@/lib/constants';

/**
 * Normalize a page path by replacing dynamic IDs with :id
 */
export function normalizePagePath(path: string): string {
  if (!path) return '/';
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+/g, '/:id')
    .replace(/(\/:\bid\b)+/g, '/:id');
}

/**
 * Derive a page category from a path.
 * Single canonical implementation (used everywhere).
 */
export function categorizePagePath(path: string): string {
  if (!path) return 'Other';
  const lower = path.toLowerCase();
  if (lower.includes('/dashboard')) return 'Dashboard';
  if (lower.includes('/conversations')) return 'Conversations';
  if (lower.includes('/contacts') || lower.includes('/customers')) return 'Contacts';
  if (lower.includes('/opportunities') || lower.includes('/funnels')) return 'Opportunities';
  if (lower.includes('/calendars') || lower.includes('/calendar')) return 'Calendars';
  if (lower.includes('/automation') || lower.includes('/workflow')) return 'Automations';
  if (lower.includes('/reporting') || lower.includes('/reports')) return 'Reporting';
  if (lower.includes('/settings') || lower.includes('/setup') || lower.includes('/crm-settings')) return 'Settings';
  if (lower.includes('/marketing')) return 'Marketing';
  if (lower.includes('/media')) return 'Media';
  if (lower.includes('/tasks')) return 'Tasks';
  if (lower.includes('/custom-menu-link')) return 'Apps';
  if (lower.includes('/payments') || lower.includes('/invoices')) return 'Payments';
  if (lower.includes('/sites') || lower.includes('/websites')) return 'Sites';
  if (lower.includes('/reputation')) return 'Reputation';
  if (lower.includes('/social')) return 'Social';
  if (lower.includes('/memberships')) return 'Memberships';
  if (lower.includes('/forms') || lower.includes('/surveys')) return 'Forms';
  if (lower.includes('/phone-system') || lower.includes('/phone')) return 'Phone';
  if (lower.includes('/email') && !lower.includes('/conversations')) return 'Email';
  return 'Other';
}

/**
 * Format seconds into human-readable duration.
 * Single canonical implementation (used everywhere).
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format minutes into "Xh Ymin" or just "Xmin" if under 60.
 * Examples: 130 → "2h 10min", 45 → "45min", 60 → "1h", 0 → "0min"
 */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}


/** Format number with commas */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** Format percentage */
export function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

/** Truncate an ID for display */
export function formatShortId(id: string): string {
  return id.length > 12 ? id.slice(0, 10) + '…' : id;
}

/** Check if a session counts as a bounce */
export function isBounce(durationSeconds: number): boolean {
  return durationSeconds < BOUNCE_THRESHOLD_SECONDS;
}

/** Sentinel stored in ghl_cache_users when a user_id can't be resolved from GHL API */
const UNKNOWN_USER_SENTINEL = 'Unknown User';

/** Resolve GHL name from cache map, falling back to short ID.
 *  "Unknown User" sentinel entries (stored to prevent re-sync loops) are
 *  intentionally not shown — the short ID is a cleaner fallback.
 *  Accepts null/undefined id gracefully (returns '—'). */
export function resolveName(
  map: Map<string, string> | undefined,
  id: string | null | undefined,
): string {
  if (!id) return '—';
  if (!map) return formatShortId(id);
  const name = map.get(id);
  if (!name || name === UNKNOWN_USER_SENTINEL) return formatShortId(id);
  return name;
}
