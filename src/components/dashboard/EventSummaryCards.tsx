import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  Calendar, UserPlus, MessageSquare, Phone, Target,
  ListChecks, StickyNote, MapPin, Mail,
} from 'lucide-react';
import type { GhlEventSummary } from '@/hooks/use-ghl-events';

// ── Category definitions ────────────────────────────────────
interface SubEvent {
  key: string;
  label: string;
}

interface EventCategory {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;        // text & icon color
  bgColor: string;      // background tint
  borderColor: string;  // border accent
  events: SubEvent[];
}

const CATEGORIES: EventCategory[] = [
  {
    id: 'appointments',
    label: 'Appointments',
    icon: <Calendar className="h-5 w-5" />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/5',
    borderColor: 'border-blue-400/20',
    events: [
      { key: 'AppointmentCreate', label: 'Created' },
      { key: 'AppointmentUpdate', label: 'Updated' },
      { key: 'AppointmentDelete', label: 'Deleted' },
    ],
  },
  {
    id: 'contacts',
    label: 'Contacts',
    icon: <UserPlus className="h-5 w-5" />,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/5',
    borderColor: 'border-emerald-400/20',
    events: [
      { key: 'ContactCreate', label: 'Created' },
      { key: 'ContactUpdate', label: 'Updated' },
      { key: 'ContactDelete', label: 'Deleted' },
      { key: 'ContactDndUpdate', label: 'DND Changed' },
      { key: 'ContactTagUpdate', label: 'Tags Changed' },
    ],
  },
  {
    id: 'messages',
    label: 'Messages & Calls',
    icon: <MessageSquare className="h-5 w-5" />,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-400/5',
    borderColor: 'border-cyan-400/20',
    events: [
      { key: 'InboundMessage', label: 'Inbound Messages' },
      { key: 'OutboundMessage', label: 'Outbound Messages' },
      { key: 'ConversationUnreadUpdate', label: 'Unread Updates' },
    ],
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    icon: <Target className="h-5 w-5" />,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/5',
    borderColor: 'border-amber-400/20',
    events: [
      { key: 'OpportunityCreate', label: 'Created' },
      { key: 'OpportunityUpdate', label: 'Updated' },
      { key: 'OpportunityDelete', label: 'Deleted' },
      { key: 'OpportunityStatusUpdate', label: 'Status Changed' },
      { key: 'OpportunityStageUpdate', label: 'Stage Changed' },
      { key: 'OpportunityMonetaryValueUpdate', label: 'Value Changed' },
      { key: 'OpportunityAssignedToUpdate', label: 'Reassigned' },
    ],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: <ListChecks className="h-5 w-5" />,
    color: 'text-violet-400',
    bgColor: 'bg-violet-400/5',
    borderColor: 'border-violet-400/20',
    events: [
      { key: 'TaskCreate', label: 'Created' },
      { key: 'TaskComplete', label: 'Completed' },
      { key: 'TaskDelete', label: 'Deleted' },
    ],
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: <StickyNote className="h-5 w-5" />,
    color: 'text-pink-400',
    bgColor: 'bg-pink-400/5',
    borderColor: 'border-pink-400/20',
    events: [
      { key: 'NoteCreate', label: 'Created' },
      { key: 'NoteUpdate', label: 'Updated' },
      { key: 'NoteDelete', label: 'Deleted' },
    ],
  },
  {
    id: 'locations',
    label: 'Locations',
    icon: <MapPin className="h-5 w-5" />,
    color: 'text-orange-400',
    bgColor: 'bg-orange-400/5',
    borderColor: 'border-orange-400/20',
    events: [
      { key: 'LocationCreate', label: 'Created' },
      { key: 'LocationUpdate', label: 'Updated' },
    ],
  },
];

// ── Component ───────────────────────────────────────────────

interface EventSummaryCardsProps {
  events: GhlEventSummary[];
  enabledEvents: Record<string, boolean>;
}

export function EventSummaryCards({ events, enabledEvents }: EventSummaryCardsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Group summary data by type, summing counts
  const summaryByType = useMemo(() => {
    const counts = new Map<string, number>();
    const msgs = { sms: 0, calls: 0, email: 0, other: 0 };
    
    events.forEach(summary => {
      counts.set(
        summary.event_type, 
        (counts.get(summary.event_type) || 0) + summary.event_count
      );
      
      // Accumulate message channel stats
      if (summary.event_type === 'InboundMessage' || summary.event_type === 'OutboundMessage') {
        msgs.sms += summary.sms_count || 0;
        msgs.calls += summary.call_count || 0;
        msgs.email += summary.email_count || 0;
        msgs.other += summary.other_msg_count || 0;
      }
    });

    return { counts, msgs };
  }, [events]);

  const categoryData = useMemo(() => {
    const { counts, msgs } = summaryByType;

    return CATEGORIES.map(cat => {
      // Only include enabled sub-events
      const enabledSubEvents = cat.events.filter(se => enabledEvents[se.key] !== false);
      if (enabledSubEvents.length === 0) return null;

      // Current counts for sub-events
      const subCounts = enabledSubEvents.map(se => ({
        ...se,
        count: counts.get(se.key) || 0,
      }));

      // Total for category
      const total = subCounts.reduce((a, b) => a + b.count, 0);

      // Message breakdown (only for messages category)
      let messageBreakdown: typeof msgs | null = null;
      if (cat.id === 'messages' && (msgs.sms > 0 || msgs.calls > 0 || msgs.email > 0 || msgs.other > 0)) {
        messageBreakdown = msgs;
      }

      return { ...cat, subCounts, total, messageBreakdown };
    }).filter(Boolean) as (EventCategory & {
      subCounts: (SubEvent & { count: number })[];
      total: number;
      messageBreakdown: typeof msgs | null;
    })[];
  }, [summaryByType, enabledEvents]);

  if (categoryData.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
      {categoryData.map(cat => {
        const isExpanded = expandedId === cat.id;
        const hasSubData = cat.subCounts.some(s => s.count > 0);

        return (
          <div
            key={cat.id}
            className={`glass-card overflow-hidden border-l-2 border transition-all duration-300 ${cat.borderColor} ${isExpanded ? 'col-span-2 lg:col-span-2' : ''}`}
          >
            {/* Main card — clickable */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : cat.id)}
              className={`w-full text-left p-4 transition-colors hover:bg-muted/20 ${cat.bgColor}`}
            >
              <div className="flex items-start justify-between">
                <div className={`rounded-xl p-1.5 ${cat.color} bg-current/10`}>
                  <span className={cat.color}>{cat.icon}</span>
                </div>
                {hasSubData && (
                  <span className={`${cat.color} opacity-50`}>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                )}
              </div>
              <div className="mt-3">
                <p className="text-2xl font-bold tabular-nums tracking-tight">{cat.total.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{cat.label}</p>
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="border-t border-border/20 p-4 space-y-2 animate-fade-in">
                {cat.subCounts.map(sub => (
                  <div key={sub.key} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{sub.label}</span>
                    <span className={`text-sm font-semibold tabular-nums ${sub.count > 0 ? 'text-foreground' : 'text-muted-foreground/30'}`}>
                      {sub.count}
                    </span>
                  </div>
                ))}

                {/* Message channel breakdown */}
                {cat.messageBreakdown && (
                  <>
                    <div className="h-px bg-border/20 my-2" />
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">By Channel</p>
                    {cat.messageBreakdown.sms > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Mail className="h-3 w-3" /> SMS
                        </span>
                        <span className="text-sm font-semibold tabular-nums">{cat.messageBreakdown.sms}</span>
                      </div>
                    )}
                    {cat.messageBreakdown.calls > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Phone className="h-3 w-3" /> Calls
                        </span>
                        <span className="text-sm font-semibold tabular-nums">{cat.messageBreakdown.calls}</span>
                      </div>
                    )}
                    {cat.messageBreakdown.email > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Mail className="h-3 w-3" /> Email
                        </span>
                        <span className="text-sm font-semibold tabular-nums">{cat.messageBreakdown.email}</span>
                      </div>
                    )}
                    {cat.messageBreakdown.other > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <MessageSquare className="h-3 w-3" /> Other
                        </span>
                        <span className="text-sm font-semibold tabular-nums">{cat.messageBreakdown.other}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
