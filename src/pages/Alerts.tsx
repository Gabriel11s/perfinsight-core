import { Bell, AlertTriangle, Info, CheckCircle2, Settings, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AlertsPage() {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight font-display">Alerts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Inactivity, usage drops, and system notifications</p>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { label: 'All', active: true },
          { label: 'Critical', icon: AlertTriangle, color: 'text-red-500' },
          { label: 'Warning', icon: Info, color: 'text-amber-500' },
          { label: 'Resolved', icon: CheckCircle2, color: 'text-emerald-500' },
        ].map(s => (
          <button
            key={s.label}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
              s.active
                ? 'bg-primary/10 text-primary'
                : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {s.icon && <s.icon className={`h-3 w-3 ${s.color || ''}`} />}
            {s.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      <div className="glass-card flex flex-col items-center justify-center py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/3 via-transparent to-transparent pointer-events-none" />
        <div className="relative">
          <div className="relative mx-auto mb-6">
            <div className="h-20 w-20 rounded-3xl bg-muted/50 flex items-center justify-center">
              <Bell className="h-9 w-9 text-muted-foreground/30" />
            </div>
            <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary/10 border-2 border-card flex items-center justify-center">
              <span className="text-[8px] font-bold text-primary">0</span>
            </div>
          </div>
          <h3 className="text-base font-semibold mb-2 text-center">No alerts yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed mb-6">
            Alerts will be generated automatically when users or locations show signs of low adoption, inactivity, or unusual usage patterns.
          </p>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 rounded-xl bg-muted/50 hover:bg-muted/80 px-4 py-2.5 text-xs font-medium transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Configure Thresholds
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: AlertTriangle, color: 'text-red-500 bg-red-500/10', title: 'Inactivity Alerts', desc: 'Triggered when a location has no sessions for a configured period' },
          { icon: Info, color: 'text-amber-500 bg-amber-500/10', title: 'Usage Drop Alerts', desc: 'Triggered when activity drops significantly compared to the average' },
          { icon: CheckCircle2, color: 'text-emerald-500 bg-emerald-500/10', title: 'Health Recovery', desc: 'Automatically resolved when metrics return to healthy levels' },
        ].map(card => (
          <div key={card.title} className="glass-card p-4 flex items-start gap-3">
            <div className={`rounded-xl p-2 shrink-0 ${card.color}`}>
              <card.icon className="h-3.5 w-3.5" />
            </div>
            <div>
              <h4 className="text-xs font-semibold mb-0.5">{card.title}</h4>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{card.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
