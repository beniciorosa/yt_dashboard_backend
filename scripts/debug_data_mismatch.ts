
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function debug() {
    console.log("--- DEBUG DATA ---");

    // 1. Check yt_links video_id population
    const { count: totalLinks, error: err1 } = await supabase.from('yt_links').select('*', { count: 'exact', head: true });
    const { count: linksWithId, error: err2 } = await supabase.from('yt_links').select('*', { count: 'exact', head: true }).not('video_id', 'is', null);

    console.log(`yt_links Total: ${totalLinks}`);
    console.log(`yt_links with video_id: ${linksWithId}`);

    // 2. Check overlap of utm_content
    const { data: deals } = await supabase.from('hubspot_negocios').select('utm_content').limit(10);
    const { data: links } = await supabase.from('yt_links').select('utm_content, video_id').limit(50);

    if (deals && links) {
        let matchCount = 0;
        deals.forEach(d => {
            const found = links.find(l => l.utm_content === d.utm_content);
            console.log(`Deal UTM: '${d.utm_content}' -> Found in Links? ${!!found} (VideoID: ${found?.video_id})`);
            if (found) matchCount++;
        });
    }

    // 3. Check sample values
    if (links && links.length > 0) {
        console.log("Sample Link:", JSON.stringify(links[0]));
    }
}

debug();
