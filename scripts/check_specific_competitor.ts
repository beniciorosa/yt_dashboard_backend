
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function checkCompetitor() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log('--- Buscando concorrente @diegorojasseller ---');
    const { data: comp, error } = await supabase
        .from('yt_competitors')
        .select('*')
        .ilike('name', '%diegorojasseller%');

    if (error) {
        console.error('Erro ao buscar:', error.message);
        return;
    }

    if (!comp || comp.length === 0) {
        console.log('Concorrente não encontrado com esse nome.');
        // Tenta buscar por handle se a coluna existir ou pelo campo de ID
        const { data: comp2 } = await supabase
            .from('yt_competitors')
            .select('*')
            .ilike('channel_id', '%diegorojasseller%');
        console.log('Resultado por ID:', comp2);
    } else {
        console.log('Concorrente encontrado:', comp);
    }
}

checkCompetitor();
