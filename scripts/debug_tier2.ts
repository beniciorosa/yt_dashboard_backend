
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';
const CHANNEL_ID = 'UCQoKB-0XBFtFUqIm4JWqN0Q';

async function debugTier2() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Pegar Video de Teste (o mais visto)
    console.log('--- Buscando Top Video ---');
    const { data: topVideos } = await supabase
        .from('yt_myvideos')
        .select('video_id, title')
        .eq('channel_id', CHANNEL_ID)
        .order('view_count', { ascending: false })
        .limit(1);

    if (!topVideos || topVideos.length === 0) {
        console.error('Nenhum vídeo encontrado');
        return;
    }

    const vid = topVideos[0].video_id;
    console.log(`🔍 Testando Tier 2 para: ${topVideos[0].title} (${vid})`);

    // 2. Refresh Token
    console.log('\n--- Refreshing Token ---');
    const { data: auth } = await supabase.from('yt_auth').select('*').eq('channel_id', CHANNEL_ID).single();
    if (!auth) {
        console.error('Auth não encontrada');
        return;
    }

    // Usando global fetch disponível no Node 18+
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID || '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
            refresh_token: auth.refresh_token,
            grant_type: 'refresh_token'
        })
    });

    const tokenData: any = await refreshRes.json();
    const token = tokenData.access_token;
    if (!token) {
        console.error('Falha ao obter token:', tokenData);
        return;
    }
    console.log('🔑 Token Obtido');

    const today = new Date().toISOString().split('T')[0];
    const analyticsUrl = 'https://youtubeanalytics.googleapis.com/v2/reports';

    // A. TESTE RETENÇÃO
    console.log('\n--- Testando Retenção ---');
    const retUrl = `${analyticsUrl}?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${vid}`;
    const retRes = await fetch(retUrl, { headers: { Authorization: `Bearer ${token}` } });
    const retData: any = await retRes.json();
    console.log('API Status:', retRes.status);
    console.log('Linhas retornadas:', retData.rows?.length || 0);

    if (retData.rows?.length > 0) {
        const retRows = retData.rows.map((r: any) => ({
            video_id: vid,
            relative_time: parseFloat(r[0]),
            retention_percentage: parseFloat(r[1]) * 100
        }));
        console.log('Exemplo 1a linha:', retRows[0]);

        const { error: delErr } = await supabase.from('yt_video_retention_curve').delete().eq('video_id', vid);
        console.log('Delete status:', delErr ? delErr.message : 'OK');

        const { error: insErr } = await supabase.from('yt_video_retention_curve').insert(retRows);
        console.log('Insert status:', insErr ? insErr.message : 'OK');
    }

    // B. TESTE SEARCH KEYWORDS
    console.log('\n--- Testando Keywords ---');
    const dUrl = `${analyticsUrl}?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceDetail&filters=video==${vid};insightTrafficSourceType==YT_SEARCH`;
    const dRes = await fetch(dUrl, { headers: { Authorization: `Bearer ${token}` } });
    const dData: any = await dRes.json();
    console.log('API Status:', dRes.status);
    console.log('Linhas retornadas:', dData.rows?.length || 0);

    if (dData.rows?.length > 0) {
        const dRows = dData.rows.slice(0, 15).map((r: any) => ({
            video_id: vid,
            source_type: 'YT_SEARCH',
            source_detail: r[0],
            views: r[1],
            watch_time_minutes: r[2]
        }));
        console.log('Exemplo 1a linha:', dRows[0]);

        const { error: delD } = await supabase.from('yt_video_traffic_details').delete().eq('video_id', vid).eq('source_type', 'YT_SEARCH').neq('source_detail', '');
        console.log('Cleanup status:', delD ? delD.message : 'OK');

        const { error: insErr } = await supabase.from('yt_video_traffic_details').insert(dRows);
        console.log('Insert status:', insErr ? insErr.message : 'OK');
    }
}

debugTier2();
