import { supabase } from '@/integrations/supabase/client';

interface SyncResult {
  locationsUpserted: number;
  usersUpserted: number;
  sessionsClaimed: number;
  userErrors?: string[];
  locationErrors?: string[];
  mode: 'incremental' | 'full';
}

export async function syncGhlNames(
  forceRefresh = false,
): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke(
    'sync-ghl-names',
    { body: { forceRefresh } },
  );
  if (error) throw new Error(error.message || 'Edge function call failed');
  if (data?.error) throw new Error(data.error);
  return {
    locationsUpserted: data?.locationsUpserted ?? 0,
    usersUpserted: data?.usersUpserted ?? 0,
    sessionsClaimed: data?.sessionsClaimed ?? 0,
    userErrors: data?.userErrors,
    locationErrors: data?.locationErrors,
    mode: data?.mode ?? 'incremental',
  };
}
