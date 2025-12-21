
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function checkCompetitor() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log('--- Buscando concorrente @diegorojasseller na tabela yt_videos ---');
    const { data: comp, error } = await supabase
        .from('yt_videos')
        .select('*')
        .or('id.ilike.%diegorojasseller%,title.ilike.%diegorojasseller%,channel_id.ilike.%diegorojasseller%');

    if (error) {
        console.error('Erro ao buscar:', error.message);
        return;
    }

    console.log('Resultados encontrados:', JSON.stringify(comp, null, 2));
}

checkCompetitor();
