import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private supabaseAdmin: SupabaseClient;

    constructor(private configService: ConfigService) {
        const url = this.configService.get<string>('SUPABASE_URL');
        const serviceRoleKey = this.configService.get<string>('SUPABASE_KEY');

        if (!url || !serviceRoleKey) {
            throw new Error('Supabase credentials missing in backend');
        }

        // Initialize Supabase with Service Role Key for Admin actions
        this.supabaseAdmin = createClient(url, serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
    }

    async verifyAdmin(token: string) {
        // 1. Get user from token
        const { data: { user }, error } = await this.supabaseAdmin.auth.getUser(token);
        if (error || !user) throw new ForbiddenException('Invalid token');

        // 2. Check role in user_roles table
        const { data: roleData, error: roleError } = await this.supabaseAdmin
            .from('user_roles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (roleError || roleData?.role !== 'admin') {
            throw new ForbiddenException('Only admins can perform this action');
        }

        return user;
    }

    async createUser(adminToken: string, userData: { email: string; password?: string }) {
        await this.verifyAdmin(adminToken);

        const { data, error } = await this.supabaseAdmin.auth.admin.createUser({
            email: userData.email,
            password: userData.password || 'Mudar@123',
            email_confirm: true
        });

        if (error) {
            this.logger.error(`Error creating user: ${error.message}`);
            throw new Error(error.message);
        }

        return { success: true, user: data.user };
    }

    async listUsers(adminToken: string) {
        await this.verifyAdmin(adminToken);

        // Get user roles joined with auth.users is tricky from client, 
        // so we list our user_roles table which has the metadata
        const { data, error } = await this.supabaseAdmin
            .from('user_roles')
            .select('*')
            .order('email', { ascending: true });

        if (error) throw error;
        return data;
    }
}
