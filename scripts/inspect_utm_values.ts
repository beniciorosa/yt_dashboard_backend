
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspect() {
    console.log("--- UTM INSPECTION ---");

    const { data: links } = await supabase.from('yt_links').select('utm_content').limit(20);
    const { data: deals } = await supabase.from('hubspot_negocios').select('utm_content').limit(20);

    console.log("LINKS UTMs:");
    links?.forEach(l => console.log(`'${l.utm_content}'`));

    console.log("\nDEALS UTMs:");
    deals?.forEach(d => console.log(`'${d.utm_content}'`));
}

inspect();
