import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkSchema() {
    console.log("--- Checking table definition ---");
    const { data: cols, error } = await supabase.rpc('get_table_info', { tname: 'reply_examples' });

    // If RPC doesn't exist, we can try to query information_schema if we have permissions
    const { data: schema, error: schemaError } = await supabase
        .from('information_schema.columns')
        .select('column_name, data_type, column_default')
        .eq('table_name', 'reply_examples');

    if (schemaError) {
        console.error("Schema query failed (standard for client keys):", schemaError.message);
    } else {
        console.table(schema);
    }

    // Check raw data again but with more detail
    const { data: raw } = await supabase
        .from('reply_examples')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

    console.log("Raw row from DB:", JSON.stringify(raw, null, 2));
}

checkSchema();
