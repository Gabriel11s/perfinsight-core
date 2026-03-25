const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres.xrcurxegylqjrbmfihte:YOUR_DB_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
});

async function run() {
  try {
    await client.connect();
    const locId = 'p98J95UDEF0sFMi8puw2';
    
    console.log(`Checking DB for location_id: ${locId}...`);
    
    const { rows: cacheRows } = await client.query('SELECT * FROM public.ghl_cache_locations WHERE location_id = $1', [locId]);
    console.log('Location Cache:', cacheRows);
    
    const { rows: tokenRows } = await client.query('SELECT * FROM public.ghl_oauth_tokens WHERE location_id = $1', [locId]);
    console.log('OAuth Tokens:', tokenRows);
    
  } catch (error) {
    console.error('Database query error:', error);
  } finally {
    await client.end();
  }
}

run();
