import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';
const GOOGLE_CLIENT_ID = '271641116604-ghj5qe7mlpfq9qu8prk31seavncelkpc.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

async function test(access_token: string, ids: string) {
    const today = new Date().toISOString().split('T')[0];

    // Teste 1: Batched Traffic Type (Already works)
    console.log("\n--- TEST 1: BATCHED TRAFFIC TYPE ---");
    const u1 = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=views&dimensions=video,insightTrafficSourceType&filters=video==${ids}`;
    const r1 = await fetch(u1, { headers: { Authorization: `Bearer ${access_token}` } });
    const j1: any = await r1.json();
    console.log("Success:", r1.ok, "Rows:", j1.rows?.length);

    // Teste 2: Batched Search Keywords
    console.log("\n--- TEST 2: BATCHED SEARCH KEYWORDS ---");
    const u2 = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=views&dimensions=video,insightTrafficSourceDetail&filters=video==${ids};insightTrafficSourceType==YT_SEARCH`;
    const r2 = await fetch(u2, { headers: { Authorization: `Bearer ${access_token}` } });
    const j2: any = await r2.json();
    console.log("Success:", r2.ok, "Rows:", j2.rows?.length);
    if (!r2.ok) console.log("Error:", j2.error.message);

    // Teste 3: Single Video Retention
    console.log("\n--- TEST 3: SINGLE VIDEO RETENTION ---");
    const singleId = ids.split(',')[0];
    const u3 = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${singleId}`;
    const r3 = await fetch(u3, { headers: { Authorization: `Bearer ${access_token}` } });
    const j3: any = await r3.json();
    console.log("Success:", r3.ok, "Rows:", j3.rows?.length);
}

async function start() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: auth }: any = await supabase.from('yt_auth').select('refresh_token').eq('channel_id', 'UCQoKB-0XBFtFUqIm4JWqN0Q').single();
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: auth.refresh_token, grant_type: 'refresh_token' })
    });
    const tdata: any = await tokenRes.json();
    const { data: videos }: any = await supabase.from('yt_myvideos').select('video_id').limit(3);
    const ids = videos.map((v: any) => v.video_id).join(',');
    await test(tdata.access_token, ids);
}

start();
