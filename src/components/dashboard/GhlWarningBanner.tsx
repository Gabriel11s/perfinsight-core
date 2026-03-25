import { AlertCircle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGhlConnection } from '@/hooks/use-ghl-connection';

export function GhlWarningBanner() {
  const { data: ghl, isLoading } = useGhlConnection();

  if (isLoading || (ghl?.connected && !ghl.isExpired)) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-center gap-3 animate-fade-in">
      <div className="rounded-lg bg-amber-500/10 p-2 shrink-0">
        <AlertCircle className="h-4 w-4 text-amber-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">GoHighLevel not connected</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect your account to see real names instead of IDs
        </p>
      </div>
      <Link
        to="/settings"
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-500 hover:bg-amber-500/20 transition-colors shrink-0"
      >
        Connect <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
