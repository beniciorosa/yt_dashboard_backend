import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function inspect(tableName: string) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log(`\n🔍 Checking columns for ${tableName}...`);
    const { data: cols, error }: any = await supabase.from(tableName).select('*').limit(1);
    if (error) console.error("Error:", error.message);
    else console.log("Columns:", Object.keys(cols[0] || {}));
}

async function run() {
    await inspect('yt_video_traffic_details');
    await inspect('yt_video_retention_curve');
}

run();
