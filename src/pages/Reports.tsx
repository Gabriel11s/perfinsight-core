import { Download, FileText, Users, MapPin, AlertTriangle, Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const reports = [
  {
    label: 'Location Report',
    desc: 'Sessions, users, health scores and adoption metrics per location',
    icon: MapPin,
    color: 'text-emerald-500 bg-emerald-500/10',
    borderColor: 'border-emerald-500/10',
  },
  {
    label: 'User Report',
    desc: 'Individual user activity, feature usage, and engagement levels',
    icon: Users,
    color: 'text-primary bg-primary/10',
    borderColor: 'border-primary/10',
  },
  {
    label: 'Feature Adoption',
    desc: 'Which GHL features are being used, session counts and time spent',
    icon: FileText,
    color: 'text-violet-500 bg-violet-500/10',
    borderColor: 'border-violet-500/10',
  },
  {
    label: 'Alerts History',
    desc: 'All generated alerts with severity, timestamps and resolution status',
    icon: AlertTriangle,
    color: 'text-amber-500 bg-amber-500/10',
    borderColor: 'border-amber-500/10',
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight font-display">Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Export analytics data as CSV for the selected date range</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {reports.map(r => (
          <div key={r.label} className={`glass-card p-5 flex items-start gap-4 group relative overflow-hidden hover:border-border/60 transition-all`}>
            <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-muted/20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className={`rounded-2xl p-3 shrink-0 ${r.color}`}>
              <r.icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0 relative">
              <h3 className="text-sm font-semibold">{r.label}</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.desc}</p>
              <Button variant="outline" size="sm" className="mt-3 gap-2 h-8 text-xs rounded-lg" disabled>
                <Download className="h-3 w-3" /> Export CSV
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Coming soon card */}
      <div className="glass-card p-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/3 via-transparent to-transparent pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="rounded-2xl bg-primary/10 p-3 shrink-0">
            <Calendar className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Automated Reports</h3>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Scheduled weekly email reports, custom date range exports, and PDF generation are coming soon.
            </p>
          </div>
          <span className="shrink-0 inline-flex items-center rounded-full bg-primary/10 text-primary px-3 py-1 text-[10px] font-semibold">
            Coming Soon
          </span>
        </div>
      </div>
    </div>
  );
}
