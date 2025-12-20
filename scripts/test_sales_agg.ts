
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testAggregation() {
    const period = 'month';
    const now = new Date('2025-12-19'); // Hardcoding reference date
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    console.log(`Testing Month: ${start.toISOString()} to ${end.toISOString()}`);

    const { data: deals, error } = await supabase
        .from('hubspot_negocios')
        .select('valor, etapa, utm_content, item_linha, data_fechamento, data_criacao, proprietario, uf_padrao')
        .or(`data_criacao.gte.${start.toISOString()},data_fechamento.gte.${start.toISOString()}`)
        .limit(10);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Fetched ${deals.length} sample deals.`);

    let totalRevenue = 0;
    deals.forEach((deal, i) => {
        const etapa = deal.etapa || '';
        const isWon = etapa.toLowerCase().includes('ganho') || etapa.toLowerCase().includes('won') || etapa.toLowerCase().includes('fechado');
        const value = Number(deal.valor || 0);

        const closingDate = deal.data_fechamento ? new Date(deal.data_fechamento) : null;
        const inClosingRange = closingDate && closingDate >= start && closingDate <= end;

        console.log(`Deal ${i}: Stage: "${etapa}", Won: ${isWon}, Value: ${value}, Date: ${deal.data_fechamento}, In Range: ${inClosingRange}`);

        if (isWon && inClosingRange) {
            totalRevenue += value;
        }
    });

    console.log(`Sample Revenue for December: ${totalRevenue}`);
}

testAggregation();
