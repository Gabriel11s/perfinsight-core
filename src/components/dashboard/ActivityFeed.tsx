import { format, parseISO } from 'date-fns';
import { resolveName } from '@/lib/helpers';
import {
  Calendar, UserPlus, MessageSquare, Target, ListChecks,
  StickyNote, MapPin, Phone, Mail,
} from 'lucide-react';
import type { GhlEvent } from '@/hooks/use-ghl-events';
import { EVENT_LABELS, getEventColor } from '@/hooks/use-ghl-events';

function getEventIcon(eventType: string) {
  if (eventType.startsWith('Appointment')) return <Calendar className="h-3 w-3" />;
  if (eventType.startsWith('Contact')) return <UserPlus className="h-3 w-3" />;
  if (eventType.includes('Message')) {
    // Check if it's a call
    return <MessageSquare className="h-3 w-3" />;
  }
  if (eventType.startsWith('Conversation')) return <MessageSquare className="h-3 w-3" />;
  if (eventType.startsWith('Opportunity')) return <Target className="h-3 w-3" />;
  if (eventType.startsWith('Task')) return <ListChecks className="h-3 w-3" />;
  if (eventType.startsWith('Note')) return <StickyNote className="h-3 w-3" />;
  if (eventType.startsWith('Location')) return <MapPin className="h-3 w-3" />;
  return <Calendar className="h-3 w-3" />;
}

function getEventDetail(event: GhlEvent): string {
  const d = event.event_data;
  if (event.event_type.startsWith('Appointment')) {
    return d.appointment?.title || d.appointment?.appointmentStatus || '';
  }
  if (event.event_type.startsWith('Contact')) {
    return d.name || d.firstName || d.email || '';
  }
  if (event.event_type.includes('Message')) {
    if (d.messageType === 'CALL') {
      const dur = d.callDuration ? `${Math.round(d.callDuration / 60)}m` : '';
      return `Call ${d.callStatus || ''} ${dur}`.trim();
    }
    const body = d.body || '';
    return body.length > 60 ? body.slice(0, 57) + '…' : body;
  }
  if (event.event_type.startsWith('Opportunity')) {
    return d.name || d.status || '';
  }
  if (event.event_type.startsWith('Task')) {
    return d.title || '';
  }
  if (event.event_type.startsWith('Note')) {
    return d.body ? (d.body.length > 60 ? d.body.slice(0, 57) + '…' : d.body) : '';
  }
  return '';
}

interface ActivityFeedProps {
  events: GhlEvent[];
  userNames?: Map<string, string>;
  locationNames?: Map<string, string>;
  showUser?: boolean;
  showLocation?: boolean;
  maxItems?: number;
  emptyMessage?: string;
}

export function ActivityFeed({
  events,
  userNames,
  locationNames,
  showUser = true,
  showLocation = true,
  maxItems = 20,
  emptyMessage = 'No activity yet',
}: ActivityFeedProps) {
  const display = events.slice(0, maxItems);

  if (display.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <Calendar className="mx-auto mb-2 h-8 w-8 opacity-15" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-h-[400px] overflow-auto pr-1">
      {display.map((event) => {
        const colorClass = getEventColor(event.event_type);
        const detail = getEventDetail(event);
        const userName = showUser && event.user_id
          ? resolveName(userNames, event.user_id)
          : null;
        const locationName = showLocation && event.location_id
          ? resolveName(locationNames, event.location_id)
          : null;

        return (
          <div
            key={event.id}
            className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted/30 transition-colors group"
          >
            {/* Icon */}
            <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full shrink-0 ${colorClass}`}>
              {getEventIcon(event.event_type)}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium">
                  {EVENT_LABELS[event.event_type] || event.event_type}
                </span>
                {userName && (
                  <span className="text-[10px] text-muted-foreground">
                    by <span className="text-foreground/80">{userName}</span>
                  </span>
                )}
              </div>
              {detail && (
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {detail}
                </p>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground/60">
                  {format(parseISO(event.event_date), 'MMM dd, HH:mm')}
                </span>
                {locationName && (
                  <>
                    <span className="text-[10px] text-muted-foreground/30">·</span>
                    <span className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]">
                      {locationName}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface EventCountBadgesProps {
  counts: Record<string, number>;
  limit?: number;
}

export function EventCountBadges({ counts, limit = 5 }: EventCountBadgesProps) {
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (sorted.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {sorted.map(([type, count]) => (
        <span
          key={type}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${getEventColor(type)} border border-current/10`}
        >
          {getEventIcon(type)}
          <span>{count}</span>
        </span>
      ))}
    </div>
  );
}
