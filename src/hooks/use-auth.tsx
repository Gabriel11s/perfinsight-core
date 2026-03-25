import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tenant, TenantMode } from '@/types';
import type { User } from '@supabase/supabase-js';

interface AuthContextValue {
  user: User | null;
  tenant: Tenant | null;
  tenantMode: TenantMode | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  tenant: null,
  tenantMode: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setTenant(null);
        setLoading(false);
      }
      // Clear all cached data on sign-out or sign-in to prevent
      // stale data from a previous account being shown
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        queryClient.clear();
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session?.user) setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  // Fetch tenant when user changes
  useEffect(() => {
    if (!user) return;

    const fetchTenant = async () => {
      // Get tenant through membership
      const { data: membership } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (membership) {
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', membership.tenant_id)
          .single();

        if (tenantData) {
          setTenant(tenantData as Tenant);
        }
      }
      setLoading(false);
    };

    fetchTenant();
  }, [user]);

  const signOut = async () => {
    queryClient.clear();
    await supabase.auth.signOut();
    setUser(null);
    setTenant(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      tenant,
      tenantMode: tenant?.mode ?? null,
      loading,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
