import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function checkData() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log("📊 Verificando dados nas colunas de analytics...");
    const { data: summary, error: err1 } = await supabase
        .from('yt_myvideos')
        .select('analytics_views, last_updated')
        .not('analytics_views', 'is', null)
        .limit(5);

    if (err1) {
        console.error("❌ Erro ao consultar yt_myvideos:", err1.message);
    } else {
        console.log(`✅ Registros com analytics_views: ${summary?.length || 0}`);
        console.log("Exemplos:", summary);
    }

    console.log("\n🚦 Verificando tráfego detail...");
    const { count, error: err2 } = await supabase
        .from('yt_video_traffic_details')
        .select('*', { count: 'exact', head: true });

    if (err2) {
        console.error("❌ Erro ao consultar yt_video_traffic_details:", err2.message);
    } else {
        console.log(`✅ Total em traffic_details: ${count}`);
    }
}

checkData();
