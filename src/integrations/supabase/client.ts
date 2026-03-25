import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/constants';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
