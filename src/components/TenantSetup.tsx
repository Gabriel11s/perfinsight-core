import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Zap } from 'lucide-react';

export default function TenantSetup() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSetup = async () => {
    if (!user) return;
    setLoading(true);
    setError('');

    try {
      const { data, error: fnError } = await supabase.functions.invoke('bootstrap-tenant', {
        body: { name: 'My Agency' },
      });

      if (fnError) throw fnError;

      // Reload to pick up new tenant
      window.location.reload();
    } catch (e: any) {
      setError(e.message || 'Setup failed. Make sure the bootstrap-tenant edge function is deployed.');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="glass-card w-full max-w-md p-8 text-center space-y-4 animate-fade-in">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary glow-primary">
          <Zap className="h-6 w-6 text-primary-foreground" />
        </div>
        <h2 className="font-display text-xl font-bold">Welcome to Dashboard Tracker</h2>
        <p className="text-sm text-muted-foreground">
          Your account needs to be linked to a tenant to view analytics data.
          Click below to set up your workspace.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button onClick={handleSetup} disabled={loading} className="w-full">
          {loading ? 'Setting up...' : 'Set Up Workspace'}
        </Button>
        <p className="text-xs text-muted-foreground">
          If this doesn't work, ensure the <code className="text-primary">bootstrap-tenant</code> edge function is deployed.
        </p>
      </div>
    </div>
  );
}
