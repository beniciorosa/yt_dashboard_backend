
/**
 * Script para disparar a sincronização detalhada via terminal.
 * Uso: npx ts-node scripts/sync_detailed.ts <CHANNEL_ID>
 */

const CHANNEL_ID = process.argv[2];
const BACKEND_URL = 'http://127.0.0.1:8080/api/youtube/sync-detailed';

async function runSync() {
    if (!CHANNEL_ID) {
        console.error('❌ Erro: Por favor, forneça o CHANNEL_ID.');
        console.log('Exemplo: npx ts-node scripts/sync_detailed.ts UC... ');
        process.exit(1);
    }

    console.log(`🚀 Iniciando sincronização detalhada para o canal: ${CHANNEL_ID}...`);

    try {
        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId: CHANNEL_ID })
        });

        const result = await response.json();

        if (response.ok) {
            console.log('✅ Sincronização concluída com sucesso!');
            console.log('Resultado:', result);
        } else {
            console.error('❌ Erro na sincronização:', result.message || result);
        }
    } catch (error: any) {
        console.error('❌ Falha na conexão com o backend:', error.message);
    }
}

runSync();
