
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function listMatches() {
    const targetUtm = 'yt-051225-meli-acabou-iniciantes';
    console.log(`Fetching all records for: '${targetUtm}'`);

    let allDeals: any[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('hubspot_negocios')
            .select('*')
            .eq('utm_content', targetUtm)
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error(error);
            break;
        }

        if (data && data.length > 0) {
            allDeals = allDeals.concat(data);
            if (data.length < pageSize) hasMore = false;
            else page++;
        } else {
            hasMore = false;
        }
    }

    console.log(`Found ${allDeals.length} records.`);

    // Sort by id for consistency
    allDeals.sort((a, b) => a.negocio_id - b.negocio_id);

    const lines = allDeals.map(d => `ID: ${d.negocio_id}, Name: ${d.negocio_nome}, Date: ${d.created_at || d.data_criacao}, UTM: ${d.utm_content}`);
    const content = lines.join('\n');

    fs.writeFileSync('matches_list.txt', content);
    console.log("Written to matches_list.txt");
    console.log(content);
}

listMatches();
