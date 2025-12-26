import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

async function checkComments() {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

    try {
        const { count, error } = await supabase
            .from('reply_examples')
            .select('*', { count: 'exact', head: true });

        if (error) throw error;
        console.log(`Total comments: ${count}`);

        const { data: sample, error: err2 } = await supabase
            .from('reply_examples')
            .select('comment_text')
            .limit(100);

        if (err2) throw err2;
        const avgLen = sample.reduce((acc, curr) => acc + curr.comment_text.length, 0) / sample.length;
        console.log(`Average length: ${avgLen.toFixed(2)} chars`);
        console.log(`Estimated total payload size: ${(count! * avgLen / 1024 / 1024).toFixed(2)} MB`);

    } catch (error) {
        console.error('Error checking comments:', error);
    }
}

checkComments();
