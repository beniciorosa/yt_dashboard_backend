
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function checkCronLogs() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log('--- Verificando Agendamentos Atuais ---');
    const { data: jobs, error: jobError } = await supabase.from('cron.job' as any).select('*');
    if (jobError) console.error('Erro ao ler cron.job:', jobError.message);
    else console.log('Jobs:', jobs);

    console.log('\n--- Verificando Histórico de Execução (Últimos 10) ---');
    const { data: runs, error: runError } = await supabase
        .from('cron.job_run_details' as any)
        .select('*')
        .order('start_time', { ascending: false })
        .limit(10);

    if (runError) console.error('Erro ao ler cron.job_run_details:', runError.message);
    else {
        runs?.forEach(run => {
            console.log(`Job: ${run.jobname} | Início: ${run.start_time} | Status: ${run.status} | Erro: ${run.return_message}`);
        });
    }
}

checkCronLogs();
