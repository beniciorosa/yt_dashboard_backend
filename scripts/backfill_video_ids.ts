
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function extractVideoId(url: string): string | null {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^?&]+)/);
    return match ? match[1] : null;
}

async function run() {
    console.log("Backfilling video_ids in yt_links...");

    const { data: links, error } = await supabase.from('yt_links').select('*');
    if (error) {
        console.error("Error fetching links:", error);
        return;
    }

    let updated = 0;
    for (const link of links) {
        if (!link.video_id && link.video_url) {
            const extractedId = extractVideoId(link.video_url);
            if (extractedId) {
                console.log(`Fixing Link ${link.id}: URL '${link.video_url}' -> ID '${extractedId}'`);
                const { error: updateError } = await supabase
                    .from('yt_links')
                    .update({ video_id: extractedId })
                    .eq('id', link.id);

                if (updateError) console.error("Error updating:", updateError);
                else updated++;
            }
        }
    }

    console.log(`Finished. Updated ${updated} rows.`);
}

run();
