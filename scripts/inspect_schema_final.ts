
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspect() {
    console.log("START_INSPECT");

    // yt_links
    const { data: links } = await supabase.from('yt_links').select('*').limit(1);
    if (links && links.length > 0) {
        console.log("YT_LINKS_COLS: " + Object.keys(links[0]).join(", "));
    } else {
        console.log("YT_LINKS: Empty or Error");
    }

    // hubspot_negocios
    const { data: hubspot } = await supabase.from('hubspot_negocios').select('*').limit(1);
    if (hubspot && hubspot.length > 0) {
        console.log("HUBSPOT_COLS: " + Object.keys(hubspot[0]).join(", "));
    } else {
        console.log("HUBSPOT: Empty or Error");
    }
    console.log("END_INSPECT");
}

inspect();
