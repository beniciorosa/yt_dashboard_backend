
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspect() {
    console.log("Inspecting Tables...");

    // Query information_schema (if permissions allow, otherwise try known tables)
    // Note: Supabase JS client doesn't support querying information_schema easily directly via SDK for some setups, 
    // but we can try a direct SQL query via 'rpc' if available, or just check the specific tables we care about.

    // Check yt_links
    console.log("CHECKING_YT_LINKS");
    const { data: links } = await supabase.from('yt_links').select('*').limit(1);
    if (links && links.length > 0) {
        console.log("YT_LINKS_KEYS: " + Object.keys(links[0]).join(","));
    } else {
        console.log("YT_LINKS_EMPTY_OR_MISSING");
    }

    // Check hubspot_negocios
    console.log("CHECKING_HUBSPOT");
    const { data: hubspot } = await supabase.from('hubspot_negocios').select('*').limit(1);
    if (hubspot && hubspot.length > 0) {
        console.log("HUBSPOT_KEYS: " + Object.keys(hubspot[0]).join(","));
    } else {
        console.log("HUBSPOT_EMPTY_OR_MISSING");
    }

    // Check yt_myvideos (or yt_videos)
    console.log("CHECKING_MYVIDEOS");
    const { data: myvideos } = await supabase.from('yt_myvideos').select('*').limit(1);
    if (myvideos && myvideos.length > 0) {
        console.log("MYVIDEOS_KEYS: " + Object.keys(myvideos[0]).join(","));
    } else {
        // Fallback
        const { data: videos } = await supabase.from('yt_videos').select('*').limit(1);
        if (videos && videos.length > 0) {
            console.log("YT_VIDEOS_KEYS: " + Object.keys(videos[0]).join(","));
        } else {
            console.log("VIDEOS_EMPTY_OR_MISSING");
        }
    }

}

inspect();
