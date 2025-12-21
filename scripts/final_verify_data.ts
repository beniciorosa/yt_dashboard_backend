
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function finalVerify() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log('--- Verificando Retenção (Tabelão) ---');
    const { count: retCount } = await supabase.from('yt_video_retention_curve').select('*', { count: 'exact', head: true });
    console.log(`Total de pontos de retenção: ${retCount}`);

    console.log('\n--- Verificando Traffic Details com source_detail (Tabelão) ---');
    const { data: detailSample, error } = await supabase
        .from('yt_video_traffic_details')
        .select('video_id, source_type, source_detail, views')
        .neq('source_detail', '')
        .limit(10);

    if (error) {
        console.error('Erro ao buscar detalhes:', error.message);
    } else {
        console.log(`Registros com source_detail encontrados: ${detailSample?.length || 0}`);
        if (detailSample && detailSample.length > 0) {
            console.log('Exemplos:', detailSample);
        }
    }

    const { count: detailCount } = await supabase
        .from('yt_video_traffic_details')
        .select('*', { count: 'exact', head: true })
        .neq('source_detail', '');
    console.log(`Total de registros com source_detail: ${detailCount}`);
}

finalVerify();
