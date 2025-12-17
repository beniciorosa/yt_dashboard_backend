
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function debug() {
    console.log("--- DEBUG SPECIFIC UTM ---");
    const targetUtm = 'yt-051225-meli-acabou-iniciantes';

    // 1. Count Total Hubspot Rows
    const { count: totalDeals } = await supabase.from('hubspot_negocios').select('*', { count: 'exact', head: true });
    console.log(`Total Deals in DB: ${totalDeals}`);

    // 2. Count Deals for Target UTM (DB side count)
    const { count: targetCount } = await supabase.from('hubspot_negocios')
        .select('*', { count: 'exact', head: true })
        .eq('utm_content', targetUtm);
    console.log(`Deals for '${targetUtm}': ${targetCount}`);

    // 3. Simulate Service Fetch (Default limit check)
    const { data: fetchDefault } = await supabase.from('hubspot_negocios').select('*');
    console.log(`Fetched Default Rows: ${fetchDefault?.length}`);

    // Check if target deals are in the fetched batch
    const foundInDefault = fetchDefault?.filter(d => d.utm_content === targetUtm).length;
    console.log(`Found in Default Fetch: ${foundInDefault}`);

    // 4. Check yt_links for this UTM
    const { data: link } = await supabase.from('yt_links').select('*').eq('utm_content', targetUtm);
    console.log(`Link found for UTM: ${JSON.stringify(link)}`);
}

debug();
