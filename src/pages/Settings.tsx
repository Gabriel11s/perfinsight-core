import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { AdSpendManager } from "@/components/dashboard/AdSpendManager";
import { useGhlConnection, getGhlConnectUrl } from "@/hooks/use-ghl-connection";
import { syncGhlNames } from "@/lib/sync-ghl";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { useGhlUserNames, useGhlLocationNames } from "@/hooks/use-tracker-data";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Link as LinkIcon,
  Unlink,
  Zap,
  Clock,
  Shield,
  Activity,
  Calendar,
  UserPlus,
  MessageSquare,
  Target,
  ListChecks,
  StickyNote,
  MapPin,
  Database,
  AlertTriangle,
  Wifi,
  WifiOff,
  Users as UsersIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePipelineStatus } from "@/hooks/use-pipeline-status";
import { formatDistanceToNow } from "date-fns";

// ── Event category definitions ──────────────────────────
const EVENT_CATEGORIES: {
  label: string;
  icon: React.ReactNode;
  color: string;
  events: { key: string; label: string; description: string }[];
}[] = [
  {
    label: "Appointments",
    icon: <Calendar className="h-3.5 w-3.5" />,
    color: "text-blue-400",
    events: [
      {
        key: "AppointmentCreate",
        label: "Created",
        description: "New appointments booked",
      },
      {
        key: "AppointmentUpdate",
        label: "Updated",
        description: "Appointment changes (reschedule, status)",
      },
      {
        key: "AppointmentDelete",
        label: "Deleted",
        description: "Cancelled appointments",
      },
    ],
  },
  {
    label: "Contacts",
    icon: <UserPlus className="h-3.5 w-3.5" />,
    color: "text-emerald-400",
    events: [
      {
        key: "ContactCreate",
        label: "Created",
        description: "New contacts / leads",
      },
      {
        key: "ContactUpdate",
        label: "Updated",
        description: "Contact profile changes",
      },
      {
        key: "ContactDelete",
        label: "Deleted",
        description: "Removed contacts",
      },
      {
        key: "ContactDndUpdate",
        label: "DND Changed",
        description: "Do-not-disturb toggled",
      },
      {
        key: "ContactTagUpdate",
        label: "Tags Changed",
        description: "Contact tags added or removed",
      },
    ],
  },
  {
    label: "Messages & Calls",
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    color: "text-cyan-400",
    events: [
      {
        key: "InboundMessage",
        label: "Inbound",
        description: "SMS, email, calls received",
      },
      {
        key: "OutboundMessage",
        label: "Outbound",
        description: "SMS, email, calls sent",
      },
      {
        key: "ConversationUnreadUpdate",
        label: "Unread Update",
        description: "Conversation unread status changed",
      },
    ],
  },
  {
    label: "Opportunities",
    icon: <Target className="h-3.5 w-3.5" />,
    color: "text-amber-400",
    events: [
      {
        key: "OpportunityCreate",
        label: "Created",
        description: "New pipeline deals",
      },
      {
        key: "OpportunityUpdate",
        label: "Updated",
        description: "Deal detail changes",
      },
      {
        key: "OpportunityDelete",
        label: "Deleted",
        description: "Removed deals",
      },
      {
        key: "OpportunityStatusUpdate",
        label: "Status Changed",
        description: "Won / lost / open changes",
      },
      {
        key: "OpportunityStageUpdate",
        label: "Stage Changed",
        description: "Pipeline stage progression",
      },
      {
        key: "OpportunityMonetaryValueUpdate",
        label: "Value Changed",
        description: "Deal value updated",
      },
      {
        key: "OpportunityAssignedToUpdate",
        label: "Reassigned",
        description: "Owner changed",
      },
    ],
  },
  {
    label: "Tasks",
    icon: <ListChecks className="h-3.5 w-3.5" />,
    color: "text-violet-400",
    events: [
      {
        key: "TaskCreate",
        label: "Created",
        description: "New tasks assigned",
      },
      {
        key: "TaskComplete",
        label: "Completed",
        description: "Tasks marked done",
      },
      { key: "TaskDelete", label: "Deleted", description: "Removed tasks" },
    ],
  },
  {
    label: "Notes",
    icon: <StickyNote className="h-3.5 w-3.5" />,
    color: "text-pink-400",
    events: [
      { key: "NoteCreate", label: "Created", description: "New notes added" },
      {
        key: "NoteUpdate",
        label: "Updated",
        description: "Note content changed",
      },
      { key: "NoteDelete", label: "Deleted", description: "Notes removed" },
    ],
  },
  {
    label: "Locations",
    icon: <MapPin className="h-3.5 w-3.5" />,
    color: "text-orange-400",
    events: [
      {
        key: "LocationCreate",
        label: "Created",
        description: "New sub-accounts",
      },
      {
        key: "LocationUpdate",
        label: "Updated",
        description: "Location details changed",
      },
    ],
  },
];

// All event keys for defaults
const ALL_EVENT_KEYS = EVENT_CATEGORIES.flatMap((c) =>
  c.events.map((e) => e.key),
);
const DEFAULT_ENABLED: Record<string, boolean> = {
  AppointmentCreate: true,
  AppointmentUpdate: true,
  AppointmentDelete: false,
  ContactCreate: true,
  ContactUpdate: false,
  ContactDelete: false,
  ContactDndUpdate: false,
  ContactTagUpdate: false,
  ConversationUnreadUpdate: false,
  InboundMessage: true,
  OutboundMessage: true,
  TaskCreate: true,
  TaskComplete: true,
  TaskDelete: false,
  OpportunityCreate: true,
  OpportunityUpdate: false,
  OpportunityDelete: false,
  OpportunityStatusUpdate: true,
  OpportunityStageUpdate: true,
  OpportunityMonetaryValueUpdate: false,
  OpportunityAssignedToUpdate: false,
  NoteCreate: false,
  NoteUpdate: false,
  NoteDelete: false,
  LocationCreate: false,
  LocationUpdate: false,
};

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const { tenant } = useAuth();
  const { data: ghlData, isLoading: ghlLoading } = useGhlConnection();
  const { data: pipelineStatus } = usePipelineStatus();
  const isConnected = ghlData?.connected === true;
  const connectUrl = tenant
    ? getGhlConnectUrl(tenant.id, window.location.origin + "/settings")
    : null;
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const { data: userNames } = useGhlUserNames();
  const { data: locationNames } = useGhlLocationNames();
  const { toast } = useToast();

  const userCount = useMemo(
    () => (userNames ? userNames.size : 0),
    [userNames],
  );
  const locationCount = useMemo(
    () => (locationNames ? locationNames.size : 0),
    [locationNames],
  );

  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Form state
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [bounceThreshold, setBounceThreshold] = useState("10");
  const [inactivityDays, setInactivityDays] = useState("7");
  const [minMinutesWeek, setMinMinutesWeek] = useState("30");
  const [dailyHealthMinutes, setDailyHealthMinutes] = useState("10");
  const [enabledEvents, setEnabledEvents] =
    useState<Record<string, boolean>>(DEFAULT_ENABLED);

  // Preference state
  const [includeEventsInLastActive, setIncludeEventsInLastActive] =
    useState(false);
  const [usersTableColumns, setUsersTableColumns] = useState<string[]>([
    "location",
    "minutes",
    "sessions",
    "events",
    "lastActivity",
    "status",
  ]);
  const [locationsTableColumns, setLocationsTableColumns] = useState<string[]>([
    "users",
    "minutes",
    "sessions",
    "events",
    "lastActivity",
    "health",
  ]);

  useEffect(() => {
    if (settings) {
      setTimezone(settings.timezone || "America/Sao_Paulo");
      setBounceThreshold(
        String(settings.thresholds?.bounce_threshold_seconds ?? 10),
      );
      setInactivityDays(String(settings.thresholds?.no_activity_days ?? 7));
      setMinMinutesWeek(String(settings.thresholds?.min_minutes_week ?? 30));
      setDailyHealthMinutes(
        String(settings.thresholds?.daily_health_minutes ?? 10),
      );
      if (settings.enabled_events) {
        setEnabledEvents({ ...DEFAULT_ENABLED, ...settings.enabled_events });
      }
      if (settings.preferences) {
        setIncludeEventsInLastActive(
          settings.preferences.include_events_in_last_active ?? false,
        );
        if (settings.preferences.users_table_columns)
          setUsersTableColumns(settings.preferences.users_table_columns);
        if (settings.preferences.locations_table_columns)
          setLocationsTableColumns(
            settings.preferences.locations_table_columns,
          );
      }
    }
  }, [settings]);

  // Handle GHL redirect
  useEffect(() => {
    const status = searchParams.get("ghl");
    if (status === "connected") {
      toast({
        title: "GHL Connected",
        description: "GoHighLevel integration is now active.",
      });
    } else if (status === "error") {
      toast({
        title: "Connection Failed",
        description: searchParams.get("message") || "Please try again.",
        variant: "destructive",
      });
    }
  }, [searchParams, toast]);

  const handleSync = async (forceRefresh = false) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncGhlNames(forceRefresh);
      const parts = [
        `${result.locationsUpserted} locations, ${result.usersUpserted} users synced`,
      ];
      if (result.sessionsClaimed > 0) {
        parts.push(`${result.sessionsClaimed} historical sessions claimed`);
      }
      setSyncResult(parts.join(". "));
      toast({ title: "Sync complete", description: parts.join(". ") + "." });
    } catch (err: any) {
      setSyncResult(`Error: ${err.message}`);
      toast({
        title: "Sync failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
      // Always refresh pipeline status and name cache so the UI reflects the latest state
      queryClient.invalidateQueries({ queryKey: ['pipeline-status'] });
      queryClient.invalidateQueries({ queryKey: ['cache-names'] });
    }
  };

  const handleDisconnect = async () => {
    if (!tenant?.id) return;
    setDisconnecting(true);
    try {
      const { error } = await supabase
        .from("ghl_oauth_tokens")
        .delete()
        .eq("tenant_id", tenant.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["ghl-connection"] });
      toast({
        title: "Disconnected",
        description: "GoHighLevel integration has been removed.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleToggleEvent = (eventKey: string, checked: boolean) => {
    setEnabledEvents((prev) => ({ ...prev, [eventKey]: checked }));
  };

  const handleToggleCategory = (
    categoryEvents: { key: string }[],
    enable: boolean,
  ) => {
    setEnabledEvents((prev) => {
      const updated = { ...prev };
      categoryEvents.forEach((e) => {
        updated[e.key] = enable;
      });
      return updated;
    });
  };

  const handleSaveSettings = () => {
    updateSettings.mutate(
      {
        timezone,
        thresholds: {
          bounce_threshold_seconds: Number(bounceThreshold),
          no_activity_days: Number(inactivityDays),
          min_minutes_week: Number(minMinutesWeek),
          usage_drop_pct: settings?.thresholds?.usage_drop_pct ?? 50,
          tracker_offline_minutes:
            settings?.thresholds?.tracker_offline_minutes ?? 60,
          daily_health_minutes: Number(dailyHealthMinutes),
        },
        enabled_events: enabledEvents,
        preferences: {
          include_events_in_last_active: includeEventsInLastActive,
          users_table_columns: usersTableColumns,
          locations_table_columns: locationsTableColumns,
        },
      },
      {
        onSuccess: () => toast({ title: "Settings saved" }),
        onError: (err: any) =>
          toast({
            title: "Error saving settings",
            description: err.message,
            variant: "destructive",
          }),
      },
    );
  };

  const enabledCount = Object.values(enabledEvents).filter(Boolean).length;
  const totalCount = ALL_EVENT_KEYS.length;
  const loading = settingsLoading || ghlLoading;

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage integrations and analytics configuration
        </p>
      </div>

      {/* System Status */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-3 p-5 border-b border-border/30">
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-500">
            <Database className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold">System Status</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Data pipeline health and tracker activity
            </p>
          </div>
          {pipelineStatus && (
            <div className="flex items-center gap-1.5">
              {pipelineStatus.sessions_24h > 0 && pipelineStatus.events_24h > 0 ? (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500">
                  <Wifi className="h-3 w-3" /> All Systems Active
                </span>
              ) : pipelineStatus.events_24h > 0 ? (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-500">
                  <AlertTriangle className="h-3 w-3" /> Tracker Inactive
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-500">
                  <WifiOff className="h-3 w-3" /> No Activity
                </span>
              )}
            </div>
          )}
        </div>
        <div className="p-5 space-y-4">
          {/* Stats Grid */}
          {pipelineStatus ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{pipelineStatus.cached_locations}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Locations</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{pipelineStatus.cached_users}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Users</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{pipelineStatus.sessions_24h}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Sessions (24h)</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{pipelineStatus.events_24h.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">GHL Events (24h)</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{pipelineStatus.active_users_24h}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Active Users (24h)</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{pipelineStatus.active_locations_24h}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Active Locations (24h)</p>
                </div>
              </div>

              {/* Last activity timestamps */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>
                  Last session:{" "}
                  <strong className="text-foreground">
                    {pipelineStatus.last_session_at
                      ? formatDistanceToNow(new Date(pipelineStatus.last_session_at), { addSuffix: true })
                      : "Never"}
                  </strong>
                </span>
                <span className="text-border">|</span>
                <span>
                  Last event:{" "}
                  <strong className="text-foreground">
                    {pipelineStatus.last_event_at
                      ? formatDistanceToNow(new Date(pipelineStatus.last_event_at), { addSuffix: true })
                      : "Never"}
                  </strong>
                </span>
              </div>

              {/* Warnings */}
              {pipelineStatus.sessions_24h === 0 && pipelineStatus.events_24h > 0 && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <p className="font-medium text-amber-500">Tracker Script Not Detected</p>
                    <p className="text-muted-foreground mt-0.5">
                      GHL events are flowing but no tracker sessions recorded in the last 24 hours.
                      Install the tracker script in each GHL sub-account via{" "}
                      <strong>Settings &gt; Business Profile &gt; Custom JS/CSS</strong>.
                    </p>
                  </div>
                </div>
              )}

              {(pipelineStatus.orphaned_sessions > 0 || pipelineStatus.orphaned_events > 0) && (
                <div className="flex items-start gap-2 rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
                  <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <p className="font-medium text-blue-500">Unclaimed Data Found</p>
                    <p className="text-muted-foreground mt-0.5">
                      {pipelineStatus.orphaned_sessions > 0 && `${pipelineStatus.orphaned_sessions} sessions`}
                      {pipelineStatus.orphaned_sessions > 0 && pipelineStatus.orphaned_events > 0 && " and "}
                      {pipelineStatus.orphaned_events > 0 && `${pipelineStatus.orphaned_events} events`}
                      {" "}not yet assigned to your account. Run a Force Refresh below to claim them.
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 skeleton rounded-lg" />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* GHL Integration */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-3 p-5 border-b border-border/30">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Zap className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold">GoHighLevel Integration</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect to resolve user and location names
            </p>
          </div>
          {isConnected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-500">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              <Unlink className="h-3 w-3" /> Not connected
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
          {!isConnected && connectUrl && (
            <Button asChild className="gap-2">
              <a href={connectUrl} target="_blank" rel="noopener noreferrer">
                <LinkIcon className="h-3.5 w-3.5" /> Connect GoHighLevel
              </a>
            </Button>
          )}

          {isConnected && (
            <>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>
                  Cached:{" "}
                  <strong className="text-foreground">{locationCount}</strong>{" "}
                  locations
                </span>
                <span>·</span>
                <span>
                  <strong className="text-foreground">{userCount}</strong> users
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 h-8 text-xs"
                  onClick={() => handleSync(false)}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Sync New Names
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 h-8 text-xs text-muted-foreground"
                  onClick={() => handleSync(true)}
                  disabled={syncing}
                >
                  <RefreshCw className="h-3 w-3" /> Full Refresh
                </Button>
                <div className="ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 h-8 text-xs text-red-500 hover:text-red-400 hover:bg-red-500/10"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Unlink className="h-3 w-3" />
                    )}
                    Disconnect
                  </Button>
                </div>
              </div>

              {syncResult && (
                <div
                  className={`rounded-lg px-3 py-2 text-xs ${syncResult.startsWith("Error") ? "bg-red-500/10 text-red-500 border border-red-500/20" : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"}`}
                >
                  {syncResult}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Event Visibility Toggles */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-3 p-5 border-b border-border/30">
          <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-500">
            <Activity className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Activity Events</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose which GHL events appear on your dashboard
            </p>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {enabledCount}/{totalCount} active
          </span>
        </div>

        <div className="divide-y divide-border/20">
          {EVENT_CATEGORIES.map((category) => {
            const catEnabled = category.events.filter(
              (e) => enabledEvents[e.key],
            ).length;
            const allOn = catEnabled === category.events.length;

            return (
              <div key={category.label} className="p-4">
                {/* Category header */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={category.color}>{category.icon}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {category.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 ml-1">
                    {catEnabled}/{category.events.length}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      className="text-[10px] text-primary/70 hover:text-primary transition-colors"
                      onClick={() =>
                        handleToggleCategory(category.events, !allOn)
                      }
                    >
                      {allOn ? "Disable all" : "Enable all"}
                    </button>
                  </div>
                </div>

                {/* Event toggles */}
                <div className="space-y-2 ml-5">
                  {category.events.map((event) => (
                    <div
                      key={event.key}
                      className="flex items-center justify-between gap-4 group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-medium ${enabledEvents[event.key] ? "text-foreground" : "text-muted-foreground/60"} transition-colors`}
                          >
                            {event.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground/40 font-mono hidden group-hover:inline">
                            {event.key}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 truncate">
                          {event.description}
                        </p>
                      </div>
                      <Switch
                        id={`event-${event.key}`}
                        checked={!!enabledEvents[event.key]}
                        onCheckedChange={(checked) =>
                          handleToggleEvent(event.key, checked)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Analytics Thresholds */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-3 p-5 border-b border-border/30">
          <div className="rounded-lg bg-amber-500/10 p-2 text-amber-500">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Alert Thresholds</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure when alerts are triggered
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Daily Health Target (minutes)
              </Label>
              <Input
                value={dailyHealthMinutes}
                onChange={(e) => setDailyHealthMinutes(e.target.value)}
                className="bg-muted/50 border-0 h-9"
                type="number"
                min="1"
              />
              <p className="text-[10px] text-muted-foreground">
                Target minutes per day for an active user/location
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Bounce Threshold (seconds)
              </Label>
              <Input
                value={bounceThreshold}
                onChange={(e) => setBounceThreshold(e.target.value)}
                className="bg-muted/50 border-0 h-9"
                type="number"
                min="1"
              />
              <p className="text-[10px] text-muted-foreground">
                Sessions shorter than this are bounces
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Inactivity Days</Label>
              <Input
                value={inactivityDays}
                onChange={(e) => setInactivityDays(e.target.value)}
                className="bg-muted/50 border-0 h-9"
                type="number"
                min="1"
              />
              <p className="text-[10px] text-muted-foreground">
                Alert after this many days without activity
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Min Weekly Minutes</Label>
              <Input
                value={minMinutesWeek}
                onChange={(e) => setMinMinutesWeek(e.target.value)}
                className="bg-muted/50 border-0 h-9"
                type="number"
                min="1"
              />
              <p className="text-[10px] text-muted-foreground">
                Users below this are flagged as low usage
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Table & Display Preferences */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-3 p-5 border-b border-border/30">
          <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-500">
            <ListChecks className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Table Display Options</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage columns and calculations across the dashboard
            </p>
          </div>
        </div>

        <div className="p-5 space-y-6">
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Last Active Definition
            </h4>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label className="text-sm font-medium leading-none">
                  Include GHL Events in "Last Active"
                </Label>
                <p className="text-[11px] text-muted-foreground max-w-sm">
                  If enabled, the "Last Active" date will use the most recent
                  GHL webhook event (e.g. SMS, Calls) if it is newer than their
                  last browser session.
                </p>
              </div>
              <Switch
                checked={includeEventsInLastActive}
                onCheckedChange={setIncludeEventsInLastActive}
              />
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t border-border/20">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Visible Columns (Users Table)
            </h4>
            <div className="flex flex-wrap gap-2">
              {[
                { id: "location", label: "Location" },
                { id: "minutes", label: "Active Time" },
                { id: "sessions", label: "Sessions" },
                { id: "events", label: "GHL Activity" },
                { id: "lastActivity", label: "Last Active" },
                { id: "status", label: "Status" },
              ].map((col) => (
                <label
                  key={col.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs cursor-pointer transition-colors ${usersTableColumns.includes(col.id) ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"}`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={usersTableColumns.includes(col.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setUsersTableColumns((prev) =>
                        checked
                          ? [...prev, col.id]
                          : prev.filter((c) => c !== col.id),
                      );
                    }}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t border-border/20">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Visible Columns (Locations Table)
            </h4>
            <div className="flex flex-wrap gap-2">
              {[
                { id: "users", label: "Users" },
                { id: "minutes", label: "Active Time" },
                { id: "sessions", label: "Sessions" },
                { id: "events", label: "GHL Activity" },
                { id: "lastActivity", label: "Last Active" },
                { id: "health", label: "Health" },
              ].map((col) => (
                <label
                  key={col.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs cursor-pointer transition-colors ${locationsTableColumns.includes(col.id) ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"}`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={locationsTableColumns.includes(col.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setLocationsTableColumns((prev) =>
                        checked
                          ? [...prev, col.id]
                          : prev.filter((c) => c !== col.id),
                      );
                    }}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timezone */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-3 p-5 border-b border-border/30">
          <div className="rounded-lg bg-violet-500/10 p-2 text-violet-500">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">General</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Timezone and display preferences
            </p>
          </div>
        </div>
        <div className="p-5">
          <div className="space-y-1.5 max-w-xs">
            <Label className="text-xs font-medium">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="bg-muted/50 border-0 h-9">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectGroup>
                  <SelectLabel>Americas</SelectLabel>
                  <SelectItem value="America/New_York">Eastern Time (New York)</SelectItem>
                  <SelectItem value="America/Chicago">Central Time (Chicago)</SelectItem>
                  <SelectItem value="America/Denver">Mountain Time (Denver)</SelectItem>
                  <SelectItem value="America/Los_Angeles">Pacific Time (Los Angeles)</SelectItem>
                  <SelectItem value="America/Anchorage">Alaska (Anchorage)</SelectItem>
                  <SelectItem value="Pacific/Honolulu">Hawaii (Honolulu)</SelectItem>
                  <SelectItem value="America/Phoenix">Arizona (Phoenix)</SelectItem>
                  <SelectItem value="America/Toronto">Toronto</SelectItem>
                  <SelectItem value="America/Vancouver">Vancouver</SelectItem>
                  <SelectItem value="America/Mexico_City">Mexico City</SelectItem>
                  <SelectItem value="America/Bogota">Bogota</SelectItem>
                  <SelectItem value="America/Lima">Lima</SelectItem>
                  <SelectItem value="America/Santiago">Santiago</SelectItem>
                  <SelectItem value="America/Buenos_Aires">Buenos Aires</SelectItem>
                  <SelectItem value="America/Sao_Paulo">Sao Paulo</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Europe</SelectLabel>
                  <SelectItem value="Europe/London">London (GMT)</SelectItem>
                  <SelectItem value="Europe/Paris">Paris (CET)</SelectItem>
                  <SelectItem value="Europe/Berlin">Berlin</SelectItem>
                  <SelectItem value="Europe/Madrid">Madrid</SelectItem>
                  <SelectItem value="Europe/Rome">Rome</SelectItem>
                  <SelectItem value="Europe/Amsterdam">Amsterdam</SelectItem>
                  <SelectItem value="Europe/Lisbon">Lisbon</SelectItem>
                  <SelectItem value="Europe/Moscow">Moscow</SelectItem>
                  <SelectItem value="Europe/Istanbul">Istanbul</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Asia & Pacific</SelectLabel>
                  <SelectItem value="Asia/Dubai">Dubai</SelectItem>
                  <SelectItem value="Asia/Kolkata">India (Kolkata)</SelectItem>
                  <SelectItem value="Asia/Singapore">Singapore</SelectItem>
                  <SelectItem value="Asia/Hong_Kong">Hong Kong</SelectItem>
                  <SelectItem value="Asia/Shanghai">Shanghai</SelectItem>
                  <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                  <SelectItem value="Asia/Seoul">Seoul</SelectItem>
                  <SelectItem value="Australia/Sydney">Sydney</SelectItem>
                  <SelectItem value="Australia/Melbourne">Melbourne</SelectItem>
                  <SelectItem value="Pacific/Auckland">Auckland</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Africa & Middle East</SelectLabel>
                  <SelectItem value="Africa/Johannesburg">Johannesburg</SelectItem>
                  <SelectItem value="Africa/Cairo">Cairo</SelectItem>
                  <SelectItem value="Africa/Lagos">Lagos</SelectItem>
                  <SelectItem value="Africa/Nairobi">Nairobi</SelectItem>
                  <SelectItem value="Asia/Jerusalem">Jerusalem</SelectItem>
                  <SelectItem value="Asia/Riyadh">Riyadh</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Ad Spend */}
      <div className="glass-card overflow-hidden">
        <div className="p-5">
          <AdSpendManager />
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          Tenant:{" "}
          <span className="font-medium text-foreground">
            {tenant?.name || "—"}
          </span>
        </p>
        <Button
          onClick={handleSaveSettings}
          disabled={updateSettings.isPending}
          className="gap-2"
        >
          {updateSettings.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
