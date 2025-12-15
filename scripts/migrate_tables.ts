
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
// Source Project (The one with 'tools', 'yt_links', etc. - Project ID: xsqpqdjffjqxdcmoytfc)
const SOURCE_URL = 'https://xsqpqdjffjqxdcmoytfc.supabase.co';
const SOURCE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzcXBxZGpmZmpxeGRjbW95dGZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzUxMjIwMywiZXhwIjoyMDc5MDg4MjAzfQ.QmSMnUA2x5AkhN_je20lcAb889-DnSyT-8w3dSQhsWM';

// Destination Project (The one with 'channel data' - Project ID: qytuhvqggsleohxndtqz)
const DEST_URL = 'https://qytuhvqggsleohxndtqz.supabase.co';
const DEST_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4';

// Tables to migrate (as per user request/screenshot)
const TABLES = [
    'allowed_users',
    'cta_presets',
    'custom_links',
    'projects',
    'reply_examples',
    'social_presets',
    'yt_links'
];

// --- MIGRATION SCRIPT ---

async function migrate() {
    console.log("Starting Migration...");
    console.log(`Source: ${SOURCE_URL}`);
    console.log(`Destination: ${DEST_URL}`);

    const sourceClient = createClient(SOURCE_URL, SOURCE_KEY, { auth: { persistSession: false } });
    const destClient = createClient(DEST_URL, DEST_KEY, { auth: { persistSession: false } });

    for (const table of TABLES) {
        console.log(`\nMigrating table: ${table}...`);

        // 1. Fetch data from Source
        const { data: rows, error: fetchError } = await sourceClient
            .from(table)
            .select('*');

        if (fetchError) {
            console.error(`Error fetching from ${table}:`, fetchError.message);
            // If table doesn't exist in source, skip
            continue;
        }

        if (!rows || rows.length === 0) {
            console.log(`No data in table ${table}. Skipping.`);
            continue;
        }

        console.log(`Found ${rows.length} rows in ${table}. Inserting into destination...`);

        // 2. Insert into Destination
        // Upsert to avoid conflicts if running multiple times
        const { error: insertError } = await destClient
            .from(table)
            .upsert(rows, { ignoreDuplicates: false }); // Force update if exists

        if (insertError) {
            console.error(`Error inserting into ${table}:`, insertError.message);
            console.error("Make sure the table exists in the destination project with the same schema!");
        } else {
            console.log(`Successfully migrated ${table}.`);
        }
    }

    console.log("\nMigration Check Complete.");
}

migrate();
