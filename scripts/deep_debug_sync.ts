import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

const GOOGLE_CLIENT_ID = '271641116604-ghj5qe7mlpfq9qu8prk31seavncelkpc.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

async function debugSync(channelId: string) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log(`🔍 Buscando token para: ${channelId}`);
    const { data: auth } = await supabase.from('yt_auth').select('refresh_token').eq('channel_id', channelId).single();

    if (!auth) {
        console.error("❌ Refresh token não encontrado no banco.");
        return;
    }

    console.log("🔄 Renovando access token...");
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: auth.refresh_token,
            grant_type: 'refresh_token',
        })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
        console.error("❌ Erro ao renovar token:", tokenData);
        return;
    }
    const accessToken = tokenData.access_token;
    console.log("✅ Token renovado com sucesso.");

    // Pegar um vídeo de exemplo que sabemos que tem views
    const { data: video } = await supabase
        .from('yt_myvideos')
        .select('video_id, title, view_count')
        .eq('channel_id', channelId)
        .order('view_count', { ascending: false })
        .limit(1)
        .single();

    if (!video) {
        console.error("❌ Nenhum vídeo encontrado para testar.");
        return;
    }

    console.log(`🧪 Testando vídeo: "${video.title}" (${video.video_id}) com ${video.view_count} views.`);

    const today = new Date().toISOString().split('T')[0];
    const url = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceType&filters=video==${video.video_id}`;

    console.log("📡 Chamando API de Analytics (Traffic Sources)...");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();

    if (!res.ok) {
        console.error("❌ Erro na API do YouTube:", data);
    } else {
        console.log("✅ Resposta da API:", JSON.stringify(data, null, 2));
        if (!data.rows || data.rows.length === 0) {
            console.warn("⚠️ A API retornou 0 linhas para este vídeo. Tentando sem o filtro de vídeo para ver o canal todo...");
            const channelUrl = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceType`;
            const res2 = await fetch(channelUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
            const data2 = await res2.json();
            console.log("✅ Resposta Canal Todo:", JSON.stringify(data2, null, 2));
        }
    }
}

const channelId = process.argv[2] || 'UCQoKB-0XBFtFUqIm4JWqN0Q';
debugSync(channelId);
