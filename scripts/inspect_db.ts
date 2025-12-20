import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function inspectTable() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const TABLE_NAME = 'yt_myvideos';

    console.log(`🔍 Inspecionando colunas da tabela: ${TABLE_NAME}...`);

    const { data: cols, error: err2 } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .limit(1);

    if (err2) {
        console.error('❌ Erro:', err2.message);
        return;
    }

    if (cols && cols.length > 0) {
        console.log('✅ Colunas encontradas:', Object.keys(cols[0]));
    } else {
        console.log('⚠️ Tabela vazia ou não encontrada.');
    }
}

inspectTable();
