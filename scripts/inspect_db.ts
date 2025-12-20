
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspect() {
    console.log("--- Hubspot Negocios Columns ---");
    const { data, error } = await supabase.from('hubspot_negocios').select('*').limit(1);
    if (error) {
        console.log("ERROR:", error.message);
    } else if (data && data.length > 0) {
        const keys = Object.keys(data[0]);
        console.log("TOTAL_KEYS:", keys.length);
        keys.forEach(k => console.log(`  - ${k}`));

        console.log("\nSEARCHING_REQUIRED_KEYS:");
        const required = ['valor', 'etapa', 'utm_content', 'item_linha', 'data_fechamento', 'data_criacao'];
        required.forEach(r => {
            console.log(`  [${r}]: ${keys.includes(r) ? 'YES' : 'NO'}`);
        });

    } else {
        console.log("NO DATA");
    }
}

inspect();
