/**
 * Embed page — renders the Dashboard Tracker inside a GHL Custom Page iframe.
 *
 * GHL passes context via URL params (configured in the Marketplace app):
 *   ?location_id={{location.id}}&user_email={{user.email}}&user_name={{user.name}}
 *
 * This page:
 * 1. Reads GHL context from URL params
 * 2. Auto-authenticates (or shows login) via Supabase
 * 3. Renders the Overview dashboard WITHOUT sidebar/topbar (iframe-optimized)
 * 4. Requests encrypted SSO data from GHL parent via postMessage
 */
import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { FiltersProvider } from '@/hooks/use-filters';
import { ThemeProvider } from '@/hooks/use-theme';
import Overview from './Overview';
import Marketing from './Marketing';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Megaphone, Activity } from 'lucide-react';

/** Minimal layout for iframe — no sidebar, no topbar */
function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="p-3 lg:p-4">
        {children}
      </main>
    </div>
  );
}

/** Loading state */
function EmbedLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading Dashboard Tracker...</p>
      </div>
    </div>
  );
}

/** GHL context from URL params */
interface GhlContext {
  locationId: string | null;
  userName: string | null;
  userEmail: string | null;
}

function useGhlContext(): GhlContext {
  const [searchParams] = useSearchParams();
  return useMemo(() => ({
    locationId: searchParams.get('location_id'),
    userName: searchParams.get('user_name'),
    userEmail: searchParams.get('user_email'),
  }), [searchParams]);
}

/** Request encrypted user data from GHL parent frame */
function useGhlSso() {
  const [ssoData, setSsoData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.message === 'REQUEST_USER_DATA_RESPONSE') {
        setSsoData(event.data.payload || event.data);
      }
    }

    window.addEventListener('message', handleMessage);

    // Request user data from GHL parent
    try {
      window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
    } catch {
      // Not in iframe or parent blocked
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return ssoData;
}

export default function Embed() {
  const { user, loading } = useAuth();
  const ghlContext = useGhlContext();
  const ssoData = useGhlSso();

  // Log GHL context for debugging
  useEffect(() => {
    if (ghlContext.locationId) {
      console.log('[Dashboard Tracker Embed] GHL context:', ghlContext);
    }
    if (ssoData) {
      console.log('[Dashboard Tracker Embed] SSO data received:', ssoData);
    }
  }, [ghlContext, ssoData]);

  if (loading) return <EmbedLoading />;

  // If not logged in, show a compact login prompt
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-auto max-w-sm rounded-lg border bg-card p-6 text-center shadow-sm">
          <Activity className="mx-auto mb-3 h-10 w-10 text-primary" />
          <h2 className="mb-2 text-lg font-semibold text-foreground">Dashboard Tracker</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Open Dashboard Tracker in a new tab to sign in, then refresh this page.
          </p>
          <a
            href={window.location.origin + '/auth'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign In
          </a>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <FiltersProvider>
        <EmbedLayout>
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="overview" className="gap-1.5">
                <BarChart3 className="h-4 w-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="marketing" className="gap-1.5">
                <Megaphone className="h-4 w-4" />
                Marketing
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <Overview />
            </TabsContent>
            <TabsContent value="marketing">
              <Marketing />
            </TabsContent>
          </Tabs>
        </EmbedLayout>
      </FiltersProvider>
    </ThemeProvider>
  );
}
