
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';
const CHANNEL_ID = 'UCQoKB-0XBFtFUqIm4JWqN0Q';

async function testTier2() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Get Token from DB
    const { data: auth } = await supabase.from('yt_auth').select('*').eq('channel_id', CHANNEL_ID).single();
    if (!auth) return console.error('No auth found');

    const clientId = '732009228801-v680itj1n2shb87208170c0kioasitk6.apps.googleusercontent.com';
    const clientSecret = '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';

    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: auth.refresh_token,
            grant_type: 'refresh_token'
        })
    });
    const tokenData: any = await refreshRes.json();
    const token = tokenData.access_token;
    if (!token) return console.error('Failed token refresh:', tokenData);

    const vid = 'Wh44_CIxfYI'; // Top video
    const today = new Date().toISOString().split('T')[0];
    const reliableEndDate = new Date(new Date().getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`\n--- Testando Video: ${vid} ---`);
    console.log(`End Date: ${reliableEndDate}`);

    // Call 1: Basic View check (to see if single vid works)
    const baseUri = 'https://youtubeanalytics.googleapis.com/v2/reports';
    const basicUrl = `${baseUri}?ids=channel==MINE&startDate=2022-01-01&endDate=${today}&metrics=views&dimensions=video&filters=video==${vid}`;
    const bRes = await fetch(basicUrl, { headers: { Authorization: `Bearer ${token}` } });
    console.log('\nBASIC VIEWS:', bRes.status);
    console.log(await bRes.json());

    // Call 2: Retention (The problematic one)
    const retUrl = `${baseUri}?ids=channel==MINE&startDate=2022-01-01&endDate=${reliableEndDate}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${vid}`;
    const rRes = await fetch(retUrl, { headers: { Authorization: `Bearer ${token}` } });
    console.log('\nRETENTION:', rRes.status);
    const rData = await rRes.json();
    console.log(JSON.stringify(rData, null, 2));

    // Call 3: Keywords
    const keyUrl = `${baseUri}?ids=channel==MINE&startDate=2022-01-01&endDate=${reliableEndDate}&metrics=views&dimensions=insightTrafficSourceDetail&filters=video==${vid};insightTrafficSourceType==YT_SEARCH`;
    const kRes = await fetch(keyUrl, { headers: { Authorization: `Bearer ${token}` } });
    console.log('\nKEYWORDS:', kRes.status);
    console.log(JSON.stringify(await kRes.json(), null, 2));
}

testTier2();
