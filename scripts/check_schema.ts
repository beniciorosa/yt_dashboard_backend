import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function checkSchema() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log("🔍 Checking columns via RPC or direct query...");
    const { data, error } = await supabase.rpc('get_table_columns', { table_name: 'yt_video_retention_curve' });

    if (error) {
        console.log("RPC Error (might not exist):", error.message);
        // Tentar buscar 1 registro de qualquer jeito para ver se dá erro de coluna inexistente depois
        const { error: err2 } = await supabase.from('yt_video_retention_curve').select('video_id').limit(1);
        if (err2) console.log("Col video_id check:", err2.message);
        else console.log("Col video_id exists!");
    } else {
        console.log("Table columns:", data);
    }
}

checkSchema();
