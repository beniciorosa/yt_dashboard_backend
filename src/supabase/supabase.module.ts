import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SyncRunsService } from './sync-runs.service';
import { SUPABASE_ADMIN } from './supabase.constants';

export { SUPABASE_ADMIN };

/** Cliente único com service_role — só existe no backend; o frontend nunca vê essa chave. */
@Global()
@Module({
    providers: [
        {
            provide: SUPABASE_ADMIN,
            inject: [ConfigService],
            useFactory: (config: ConfigService): SupabaseClient => {
                const url = config.get<string>('SUPABASE_URL');
                const key = config.get<string>('SUPABASE_KEY');
                if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY ausentes no backend');
                return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
            },
        },
        SyncRunsService,
    ],
    exports: [SUPABASE_ADMIN, SyncRunsService],
})
export class SupabaseModule { }
