const { createClient } = require('@supabase/supabase-js');
const sb = createClient('https://xrcurxegylqjrbmfihte.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: tokens } = await sb.from('ghl_oauth_tokens')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1);
    
  if(!tokens?.length) return console.log('No token found');
  
  const tokenRow = tokens[0];
  console.log('Most recently updated token selected! Tenant:', tokenRow.tenant_id);
  console.log('Scopes on token:', tokenRow.scopes || 'Not Saved');
  console.log('Updated At:', tokenRow.updated_at);
  
  const res = await fetch('https://services.leadconnectorhq.com/users/ve9EPM428h8vShlRW1KT', {
    headers: { "Authorization": `Bearer ${tokenRow.access_token}`, "Version": "2021-07-28", "Accept": "application/json" }
  });
  const json = await res.json();
  console.log('API Status:', res.status);
  console.log('API Response:', json);
}
check();
