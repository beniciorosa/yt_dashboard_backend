import { createClient } from '@supabase/supabase-js';

/**
 * Script para disparar a sincronização detalhada via terminal de forma orquestrada (evita timeout).
 * Uso: npx ts-node scripts/sync_detailed.ts <CHANNEL_ID>
 */

const CHANNEL_ID = process.argv[2];
const BACKEND_URL = 'https://yt-dashboard-backend.vercel.app/api/youtube/sync-detailed';

const SUPABASE_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

async function runSync() {
    if (!CHANNEL_ID) {
        console.error('❌ Erro: Por favor, forneça o CHANNEL_ID.');
        console.log('Exemplo: npx ts-node scripts/sync_detailed.ts UC... ');
        process.exit(1);
    }

    console.log(`🚀 Iniciando orquestração para o canal: ${CHANNEL_ID}...`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Buscar IDs de vídeos para parcelar o trabalho e evitar timeouts na Vercel
    const { data: videos, error }: any = await supabase
        .from('yt_myvideos')
        .select('video_id')
        .eq('channel_id', CHANNEL_ID);

    if (error) {
        console.error('❌ Erro ao buscar vídeos no Supabase:', error.message);
        process.exit(1);
    }

    if (!videos || videos.length === 0) {
        console.log('⚠️ Nenhum vídeo encontrado para este canal no banco de dados.');
        process.exit(0);
    }

    const videoIds = videos.map((v: any) => v.video_id);
    const total = videoIds.length;
    console.log(`📦 Total de vídeos para sincronizar: ${total}`);

    // Processar em pedaços pequenos (ex: 20 por vez) para garantir que termine antes de 10s (Vercel)
    const chunkSize = 20;
    for (let i = 0; i < videoIds.length; i += chunkSize) {
        const chunk = videoIds.slice(i, i + chunkSize);
        const isFirstBatch = i === 0;

        process.stdout.write(`⏳ Lote ${Math.floor(i / chunkSize) + 1}/${Math.ceil(total / chunkSize)} (${chunk.length} vids${isFirstBatch ? ' + Deep Dive' : ''})... `);

        try {
            const response = await fetch(BACKEND_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channelId: CHANNEL_ID,
                    videoIds: chunk,
                    includeDeepDive: isFirstBatch
                })
            });

            if (response.ok) {
                console.log('✅');
            } else {
                const errText = await response.text();
                // Limitar log de erro longo
                const displayErr = errText.length > 60 ? errText.substring(0, 60) + '...' : errText;
                console.log(`❌ (Erro: ${displayErr})`);
            }
        } catch (error: any) {
            console.log(`❌ (Falha Conexão: ${error.message})`);
        }
    }

    console.log('\n🏁 Processo de orquestração concluído!');
}

runSync();
