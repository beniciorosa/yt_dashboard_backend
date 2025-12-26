import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Credentials missing');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkHistory() {
    console.log("--- Checking History Timestamps ---");
    const { data, error } = await supabase
        .from('reply_examples')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error("Error:", error);
        return;
    }

    data?.forEach(row => {
        console.log(`ID: ${row.id}`);
        console.log(`Created At (DB): ${row.created_at}`);
        console.log(`Parsed Date: ${new Date(row.created_at).toISOString()}`);
        console.log(`---`);
    });
}

checkHistory();
