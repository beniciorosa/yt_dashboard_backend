
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';
const CHANNEL_ID = 'UCQoKB-0XBFtFUqIm4JWqN0Q';

async function inspectData() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log('--- Verificando estrutura de yt_myvideos ---');
    const { data: cols, error: colErr } = await supabase.from('yt_myvideos').select('*').limit(1);
    if (cols && cols.length > 0) {
        console.log('Colunas disponíveis:', Object.keys(cols[0]));
    } else {
        console.log('Erro ao ler colunas ou tabela vazia:', colErr?.message);
    }

    console.log('\n--- Buscando Top 5 Vídeos (usando colunas prováveis) ---');
    // Testando com analytics_views primeiro, depois view_count
    const { data: topA } = await supabase
        .from('yt_myvideos')
        .select('video_id, title, analytics_views')
        .eq('channel_id', CHANNEL_ID)
        .order('analytics_views', { ascending: false, nullsFirst: false })
        .limit(5);

    console.log('Top por analytics_views:', topA?.map(v => `${v.title} (${v.analytics_views} views)`));

    const { data: topV } = await supabase
        .from('yt_myvideos')
        .select('video_id, title, view_count')
        .eq('channel_id', CHANNEL_ID)
        .order('view_count', { ascending: false, nullsFirst: false })
        .limit(5);

    console.log('Top por view_count:', topV?.map(v => `${v.title} (${v.view_count} views)`));

    console.log('\n--- Verificando registros de tráfego ---');
    const { count } = await supabase.from('yt_video_traffic_details').select('*', { count: 'exact', head: true });
    console.log(`Total de registros em yt_video_traffic_details: ${count}`);

    const { data: sampleTraffic } = await supabase.from('yt_video_traffic_details').select('video_id, source_type, source_detail').limit(5);
    console.log('Amostra de tráfego:', sampleTraffic);
}

inspectData();
