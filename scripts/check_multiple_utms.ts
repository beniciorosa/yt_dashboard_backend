
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkMultipleUtms() {
    const targetUtm = 'yt-051225-meli-acabou-iniciantes';
    console.log(`Target UTM: ${targetUtm}`);

    // 1. Get Video ID
    const { data: links } = await supabase.from('yt_links').select('*').eq('utm_content', targetUtm);
    if (!links || links.length === 0) {
        console.log("No link found for target UTM.");
        return;
    }
    const videoId = links[0].video_id;
    console.log(`Video ID: ${videoId}`);

    if (!videoId) {
        console.log("Video ID is null.");
        return;
    }

    // 2. Get ALL links for this Video ID
    const { data: allLinks } = await supabase.from('yt_links').select('*').eq('video_id', videoId);
    console.log(`Found ${allLinks?.length} links for this video.`);

    // 3. Count Deals for EACH link
    console.log("\n--- DEALS PER UTM ---");
    let grandTotal = 0;

    // Fetch all deals once (optimized) or loop (simple)
    const { data: allDeals } = await supabase.from('hubspot_negocios').select('utm_content');

    if (allLinks && allDeals) {
        for (const link of allLinks) {
            const utm = link.utm_content;
            // Count exact + fuzzy
            const matches = allDeals.filter(d => d.utm_content && d.utm_content.trim().toLowerCase() === utm.trim().toLowerCase());
            console.log(`UTM: '${utm}' -> Count: ${matches.length}`);

            // Print fuzzy details for the main one
            if (utm === targetUtm && matches.length > 65) {
                const fuzzy = matches.filter(d => d.utm_content !== utm);
                console.log(`   > Exact Matches: ${matches.length - fuzzy.length}`);
                console.log(`   > Fuzzy Matches: ${fuzzy.length}`);
                fuzzy.forEach(f => console.log(`     - '${f.utm_content}'`));
            }

            grandTotal += matches.length;
        }
    }

    console.log(`\nGrand Total Calculated: ${grandTotal}`);
}

checkMultipleUtms();
