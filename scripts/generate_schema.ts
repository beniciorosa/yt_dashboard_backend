
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Source Project Source
const SOURCE_URL = 'https://xsqpqdjffjqxdcmoytfc.supabase.co';
const SOURCE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzcXBxZGpmZmpxeGRjbW95dGZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzUxMjIwMywiZXhwIjoyMDc5MDg4MjAzfQ.QmSMnUA2x5AkhN_je20lcAb889-DnSyT-8w3dSQhsWM';

const sourceClient = createClient(SOURCE_URL, SOURCE_KEY, { auth: { persistSession: false } });

// Tables to inspect
const TABLES = [
    'allowed_users',
    'cta_presets',
    'custom_links',
    'projects',
    'reply_examples',
    'social_presets',
    'yt_links'
];

async function generateSchema() {
    console.log("Fetching Schema Information...");

    // We can't easily get full DDL via PostgREST, but we can infer basic structure from an empty select or (hopefully) information_schema but Supabase API usually blocks information_schema.
    // Let's try to fetch 1 row from each table to guess types, OR rely on whatever we can get.
    // Actually, asking for 1 row is safer.

    let sqlOutput = "";

    for (const table of TABLES) {
        console.log(`Inspecting ${table}...`);

        // Fetch one row to infer structure
        const { data, error } = await sourceClient.from(table).select('*').limit(1);

        if (error) {
            console.error(`Error accessing ${table}: ${error.message}`);
            continue;
        }

        if (data && data.length > 0) {
            const row = data[0];
            const columns = Object.keys(row);

            sqlOutput += `CREATE TABLE IF NOT EXISTS public.${table} (\n`;

            const colDefs = columns.map(col => {
                const val = row[col];
                let type = 'TEXT'; // Default
                if (typeof val === 'number') type = Number.isInteger(val) ? 'BIGINT' : 'NUMERIC';
                if (typeof val === 'boolean') type = 'BOOLEAN';
                if (typeof val === 'object') type = 'JSONB';
                // Heuristics for dates
                if (typeof val === 'string' && !isNaN(Date.parse(val)) && (val.includes('-') || val.includes(':'))) {
                    type = 'TIMESTAMP WITH TIME ZONE';
                }

                // Primary key heuristic
                const isPk = col === 'id' ? ' PRIMARY KEY' : '';
                // Default heuristic
                const isDefault = col === 'created_at' ? ' DEFAULT now()' : '';

                return `    ${col} ${type}${isPk}${isDefault}`;
            });

            sqlOutput += colDefs.join(',\n');
            sqlOutput += `\n);\n\n`; // Enable RLS by default recommendation? Maybe not for simple migration.
            sqlOutput += `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;\n\n`;

        } else {
            console.log(`Table ${table} is empty. Cannot infer schema from data.`);
            // Fallback: Create generic text columns? No, dangerous.
            sqlOutput += `-- Table ${table} was empty. Could not infer schema.\n\n`;
        }
    }

    // Try to write to file
    fs.writeFileSync('migration_schema.sql', sqlOutput);
    console.log("Schema SQL generated at migration_schema.sql");
}

generateSchema();
