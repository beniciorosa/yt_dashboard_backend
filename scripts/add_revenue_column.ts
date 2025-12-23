
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function addColumns() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    console.log('--- Adicionando colunas de métricas em yt_myvideos ---');

    // Como não temos acesso direto ao SQL via SDK do Supabase sem RPC, 
    // tentaremos um hack comum: se não pudermos rodar SQL direto, 
    // ao menos sabemos que o problema é o schema.
    // Mas geralmente este projeto usa uma Edge Function ou RPC para migrations.
    // Vou tentar uma inserção com a coluna nova para ver se o PostgREST reclama.

    // Na verdade, o melhor é informar ao usuário ou usar um endpoint de SQL se disponível.
    // Mas vou tentar usar o RPC 'exec_sql' se existir.

    const sql = `
        ALTER TABLE public.yt_myvideos ADD COLUMN IF NOT EXISTS estimated_revenue NUMERIC DEFAULT 0;
        ALTER TABLE public.yt_myvideos ADD COLUMN IF NOT EXISTS analytics_views INTEGER DEFAULT 0;
        ALTER TABLE public.yt_myvideos ADD COLUMN IF NOT EXISTS estimated_minutes_watched INTEGER DEFAULT 0;
        ALTER TABLE public.yt_myvideos ADD COLUMN IF NOT EXISTS subscribers_gained INTEGER DEFAULT 0;
    `;

    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
        console.error('Erro ao adicionar colunas via RPC:', error.message);
        console.log('Nota: Se o RPC exec_sql não existir, você deve adicionar as colunas manualmente no dashboard do Supabase.');
    } else {
        console.log('Colunas adicionadas com sucesso!');
    }
}

addColumns();
