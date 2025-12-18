import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load env
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY in env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const ICONS_DIR = path.join(__dirname, '..', '..', 'icones', 'icones-bandeiras-br-uf-master', 'dist', 'rounded', 'svg');

const ufMapping: Record<string, string> = {
    'acre': 'AC',
    'alagoas': 'AL',
    'amapa': 'AP',
    'amazonas': 'AM',
    'bahia': 'BA',
    'ceara': 'CE',
    'distrito-federal': 'DF',
    'espirito-santo': 'ES',
    'goias': 'GO',
    'maranhao': 'MA',
    'mato-grosso': 'MT',
    'mato-grosso-do-sul': 'MS',
    'minas-gerais': 'MG',
    'para': 'PA',
    'paraiba': 'PB',
    'parana': 'PR',
    'pernambuco': 'PE',
    'piaui': 'PI',
    'rio-de-janeiro': 'RJ',
    'rio-grande-do-norte': 'RN',
    'rio-grande-do-sul': 'RS',
    'rondonia': 'RO',
    'roraima': 'RR',
    'santa-catarina': 'SC',
    'sao-paulo': 'SP',
    'sergipe': 'SE',
    'tocantins': 'TO'
};

async function uploadIcons() {
    console.log('Starting icon upload...');

    // 1. Create tables if they don't exist (using raw SQL if possible, otherwise we assume they exist)
    // Note: Supabase JS client doesn't support direct DDL easily without a custom RPC.
    // We will assume the user or another process runs the icons_schema.sql.

    const files = fs.readdirSync(ICONS_DIR);

    for (const file of files) {
        if (!file.endsWith('.svg')) continue;

        // Extract state name from filename: e.g., "02-acre-rounded.svg" -> "acre"
        const match = file.match(/^\d+-(.+)-rounded(?:-v\d+)?\.svg$/);
        if (!match) continue;

        const stateName = match[1];
        const uf = ufMapping[stateName];

        if (!uf) {
            console.warn(`No UF mapping found for state: ${stateName} (file: ${file})`);
            continue;
        }

        const filePath = path.join(ICONS_DIR, file);
        const svgContent = fs.readFileSync(filePath, 'utf8');

        console.log(`Processing ${uf} (${file})...`);

        // Upsert icon metadata
        const { data: iconData, error: iconError } = await supabase
            .from('icons')
            .upsert({ icon_name: uf, icon_info: `Bandeira de ${stateName}` }, { onConflict: 'icon_name' })
            .select()
            .single();

        if (iconError) {
            console.error(`Error upserting icon record for ${uf}:`, iconError);
            continue;
        }

        // Upsert icon file
        const { error: fileError } = await supabase
            .from('icon_files')
            .upsert({ icon_id: iconData.id, svg_content: svgContent }, { onConflict: 'icon_id' });

        if (fileError) {
            console.error(`Error uploading SVG for ${uf}:`, fileError);
        } else {
            console.log(`Successfully uploaded icon for ${uf}`);
        }
    }

    console.log('Done.');
}

uploadIcons().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
