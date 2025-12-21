
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function validateTopVideos() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // IDs dos top vídeos identificados no passo anterior
    const topVids = ['Wh44_CIxfYI', '8mD_Wf4k1YQ', 'FskH8Wf-uIk', 'jK7m3gX7X7I', 'vSIs6e2nPk8'];

    console.log('--- Verificando Retenção (Top 5) ---');
    const { data: ret, error: retErr } = await supabase
        .from('yt_video_retention_curve')
        .select('video_id, count')
        .in('video_id', topVids);

    // Agregando por video_id para ver se tem algo
    for (const vid of topVids) {
        const { count } = await supabase.from('yt_video_retention_curve').select('*', { count: 'exact', head: true }).eq('video_id', vid);
        console.log(`Video ${vid}: ${count} pontos de retenção`);
    }

    console.log('\n--- Verificando Traffic Details com source_detail (Top 5) ---');
    for (const vid of topVids) {
        const { data: details } = await supabase
            .from('yt_video_traffic_details')
            .select('source_type, source_detail, views')
            .eq('video_id', vid)
            .neq('source_detail', '');

        console.log(`Video ${vid}: ${details?.length || 0} detalhes de tráfego encontrados`);
        if (details && details.length > 0) {
            console.log('Exemplo:', details[0]);
        }
    }
}

validateTopVideos();
