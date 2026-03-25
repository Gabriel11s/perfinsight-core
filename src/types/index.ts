// Core types for Dashboard Tracker

export type TenantMode = "agency" | "single_location";

export interface Tenant {
  id: string;
  name: string;
  mode: TenantMode;
  created_at: string;
  owner_user_id: string;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "viewer";
  created_at: string;
}

export interface TrackerSession {
  id: string;
  tenant_id: string | null;
  location_id: string;
  user_id: string;
  page_path: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  heartbeats: number;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface GhlCacheLocation {
  tenant_id: string;
  location_id: string;
  location_name: string;
  updated_at: string;
}

export interface GhlCacheUser {
  tenant_id: string;
  location_id: string | null;
  user_id: string;
  user_name: string;
  updated_at: string;
}

export interface Alert {
  id: string;
  tenant_id: string;
  severity: "low" | "medium" | "high";
  type: string;
  location_id: string | null;
  user_id: string | null;
  metric: Record<string, unknown>;
  status: "open" | "closed";
  created_at: string;
}

export interface Settings {
  tenant_id: string;
  timezone: string;
  working_hours: {
    start: string;
    end: string;
    days: number[];
  };
  thresholds: {
    no_activity_days: number;
    min_minutes_week: number;
    usage_drop_pct: number;
    bounce_threshold_seconds: number;
    tracker_offline_minutes: number;
    daily_health_minutes: number;
  };
  enabled_events: Record<string, boolean>;
  preferences: {
    users_table_columns: string[];
    locations_table_columns: string[];
    include_events_in_last_active: boolean;
  };
  ghl_token_webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

export type PageCategory =
  | "dashboard"
  | "conversations"
  | "contacts"
  | "opportunities"
  | "calendars"
  | "automations"
  | "reporting"
  | "settings"
  | "marketing"
  | "media"
  | "other";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface KpiData {
  activeMinutes: number;
  sessions: number;
  uniqueUsers: number;
  uniqueLocations: number;
  avgSessionDuration: number;
  bounceRate: number;
}

export type RiskLevel = "low" | "medium" | "high";
