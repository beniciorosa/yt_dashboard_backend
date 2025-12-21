
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function listTables() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log('--- Listando tabelas do schema public ---');
    const { data, error } = await supabase.rpc('get_tables' as any); // Tenta um RPC comum se houver

    // Se falhar, vamos tentar uma query direta básica no yt_competitors mas com fetch
    const res = await fetch(`${SUPABASE_URL}/rest/v1/yt_competitors?select=*&limit=1`, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    console.log('Status da tabela yt_competitors:', res.status);
    if (res.ok) {
        const rows = await res.json();
        console.log('Exemplo de linha:', rows);
    } else {
        console.log('Erro ao acessar via REST:', await res.text());
    }
}

listTables();
