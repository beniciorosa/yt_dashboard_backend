import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function verifyTable() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log('--- Verifying table: comment_favorites ---');

    try {
        const { data, error } = await supabase
            .from('comment_favorites')
            .select('*')
            .limit(1);

        if (error) {
            console.error('Error selecting from comment_favorites:', error);
            if (error.code === '42P01') {
                console.log('CONFIRMED: Table "comment_favorites" does not exist.');
            }
        } else {
            console.log('Table exists. Samples:', data);
        }
    } catch (e) {
        console.error('Exception caught:', e);
    }
}

verifyTable();
