-- Segredo compartilhado entre o pg_cron e o backend. Fica só no banco (RLS sem policy =
-- apenas service_role): o cron o envia no header x-cron-secret e o AuthGuard confere.
create table if not exists public.app_secrets (
    name text primary key,
    value text not null,
    created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

insert into public.app_secrets (name, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- Os jobs leem o segredo na hora de executar; o valor não fica gravado no comando.
select cron.schedule('sync-concorrentes-manha', '0 11 * * *', $$
    select net.http_get(
        url := 'https://yt-dashboard-backend.vercel.app/api/update',
        headers := jsonb_build_object('x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')),
        timeout_milliseconds := 60000)
$$);
select cron.schedule('sync-concorrentes-noite', '0 23 * * *', $$
    select net.http_get(
        url := 'https://yt-dashboard-backend.vercel.app/api/update',
        headers := jsonb_build_object('x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')),
        timeout_milliseconds := 60000)
$$);
-- A cada 2 h (antes: 2x ao dia): cada execução cabe no limite de 60 s da função e processa
-- primeiro os vídeos mais desatualizados, então o canal inteiro é revisitado em poucos dias.
select cron.schedule('sync-meus-videos-auto', '0 */2 * * *', $$
    select net.http_get(
        url := 'https://yt-dashboard-backend.vercel.app/api/sync-my-videos?channelId=UCQoKB-0XBFtFUqIm4JWqN0Q',
        headers := jsonb_build_object('x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')),
        timeout_milliseconds := 60000)
$$);
