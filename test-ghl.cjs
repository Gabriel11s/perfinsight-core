const { createClient } = require('@supabase/supabase-js');
const sb = createClient('https://xrcurxegylqjrbmfihte.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check(){
 const { data: tokenRows } = await sb.from('ghl_oauth_tokens').select('access_token, company_id').limit(1);
 const tokenRow = tokenRows[0];
 
 const res = await fetch(`https://services.leadconnectorhq.com/users/ve9EPM428h8vShlRW1KT`, {
   headers: { "Authorization": `Bearer ${tokenRow.access_token}`, "Version": "2021-07-28", "Accept": "application/json" }
 });
 const json = await res.json();
 console.log('Single Fetch Result:', res.status, json);
}
check();
