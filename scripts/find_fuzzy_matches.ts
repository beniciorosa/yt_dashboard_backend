
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function findFuzzyMatches() {
    const targetUtm = 'yt-051225-meli-acabou-iniciantes';
    console.log(`Searching for fuzzy matches for: '${targetUtm}'`);

    let allDeals: any[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    // Fetch ALL deals
    while (hasMore) {
        const { data, error } = await supabase
            .from('hubspot_negocios')
            .select('negocio_id, utm_content, negocio_nome')
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error('Error:', error);
            return;
        }

        if (data && data.length > 0) {
            allDeals = allDeals.concat(data);
            if (data.length < pageSize) hasMore = false;
            else page++;
        } else {
            hasMore = false;
        }
    }

    console.log(`Total Deals Scanned: ${allDeals.length}`);

    const exactMatches: any[] = [];
    const fuzzyMatches: any[] = [];

    allDeals.forEach(deal => {
        if (!deal.utm_content) return;

        const raw = deal.utm_content;
        const normalized = raw.trim().toLowerCase();

        if (normalized === targetUtm) {
            if (raw === targetUtm) {
                exactMatches.push(deal);
            } else {
                fuzzyMatches.push(deal);
            }
        }
    });

    console.log(`\nExact Matches: ${exactMatches.length}`);
    console.log(`Fuzzy Matches (variations): ${fuzzyMatches.length}`);

    if (fuzzyMatches.length > 0) {
        console.log("\n--- DISCREPANCY DETAILS ---");
        fuzzyMatches.forEach(d => {
            console.log(`ID: ${d.negocio_id} | Raw UTM: '${d.utm_content}' | Name: ${d.negocio_nome}`);
        });
    } else {
        console.log("\nNo fuzzy matches found. The discrepancy might be due to pagination logic in the previous view versus total count??");
        // Double check count logic
    }
}

findFuzzyMatches();
