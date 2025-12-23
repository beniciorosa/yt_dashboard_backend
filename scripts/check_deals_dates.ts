
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkDates() {
    const { data, error } = await supabase
        .from('hubspot_negocios')
        .select('data_criacao, data_fechamento, utm_content, etapa')
        .order('data_criacao', { ascending: false })
        .limit(5);

    if (error) {
        console.error(error);
        return;
    }

    console.log('Sample Deals:');
    console.log(JSON.stringify(data, null, 2));

    const now = new Date();
    console.log('Current Server Date (UTC?):', now.toISOString());
    console.log('Current Server Date string:', now.toString());
}

checkDates();
