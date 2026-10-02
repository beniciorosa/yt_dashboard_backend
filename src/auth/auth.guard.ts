import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';
import { SUPABASE_ADMIN } from '../supabase/supabase.constants';

const CRON_ACCESS = 'cronAccess';
const PUBLIC_ROUTE = 'publicRoute';

/** Rota que o pg_cron também pode chamar, enviando o header `x-cron-secret`. */
export const CronAccess = () => SetMetadata(CRON_ACCESS, true);
/** Rota sem autenticação (use só para health-check). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

const TOKEN_CACHE_MS = 60_000;

/**
 * Guard global: toda rota exige o JWT de um usuário logado no Supabase
 * (`Authorization: Bearer <access_token>`). O app é single-tenant, então estar
 * autenticado basta; ações de admin continuam checando `user_roles` no AuthService.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    private readonly cache = new Map<string, { userId: string; email?: string; exp: number }>();
    private cronSecretCache: { value: string | null; exp: number } | null = null;

    constructor(
        private readonly reflector: Reflector,
        private readonly config: ConfigService,
        @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const targets = [context.getHandler(), context.getClass()];
        if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;

        const req = context.switchToHttp().getRequest();

        if (this.reflector.getAllAndOverride<boolean>(CRON_ACCESS, targets) && (await this.hasCronSecret(req))) {
            return true;
        }

        const header: string | undefined = req.headers['authorization'];
        const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
        if (!token) throw new UnauthorizedException('Token ausente');

        const now = Date.now();
        const cached = this.cache.get(token);
        if (cached && cached.exp > now) {
            req.user = { id: cached.userId, email: cached.email };
            return true;
        }

        const { data, error } = await this.supabase.auth.getUser(token);
        if (error || !data?.user) throw new UnauthorizedException('Token inválido ou expirado');

        if (this.cache.size > 500) this.cache.clear();
        this.cache.set(token, { userId: data.user.id, email: data.user.email, exp: now + TOKEN_CACHE_MS });
        req.user = { id: data.user.id, email: data.user.email };
        return true;
    }

    /**
     * O segredo do cron vive em app_secrets (só service_role lê): o pg_cron o envia no header
     * e o backend o confere, sem precisar copiar o valor para as variáveis da Vercel.
     * CRON_SECRET no ambiente, se existir, tem precedência (dev local).
     */
    private async cronSecret(): Promise<string | null> {
        const fromEnv = this.config.get<string>('CRON_SECRET');
        if (fromEnv) return fromEnv;
        if (this.cronSecretCache && this.cronSecretCache.exp > Date.now()) return this.cronSecretCache.value;

        const { data } = await this.supabase.from('app_secrets').select('value').eq('name', 'cron_secret').maybeSingle();
        const value = data?.value || null;
        this.cronSecretCache = { value, exp: Date.now() + 5 * 60_000 };
        return value;
    }

    private async hasCronSecret(req: any): Promise<boolean> {
        const given = req.headers['x-cron-secret'];
        if (typeof given !== 'string' || !given) return false;
        const expected = await this.cronSecret();
        if (!expected) return false;
        const a = Buffer.from(given);
        const b = Buffer.from(expected);
        return a.length === b.length && timingSafeEqual(a, b);
    }
}
