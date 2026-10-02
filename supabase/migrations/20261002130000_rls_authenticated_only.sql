-- Fecha o acesso ANÔNIMO às tabelas do yt_dashboard. Usuários logados continuam vendo tudo
-- (app interno, single-tenant); o backend usa service_role e ignora RLS.
--
-- Fora deste arquivo, de propósito:
--   * funções upsert_negocios / get_last_update / get_ultima_data_negocio e a tabela ultima_data:
--     são usadas pela automação externa do HubSpot, que pode estar chamando com a chave anon.
--     Só revogar depois de confirmar qual chave ela usa.
--   * tabelas de outros apps no mesmo projeto (sidebar_*, treino, whoop_*).

-- refresh_token do YouTube: só o backend lê.
alter table public.yt_auth enable row level security;
revoke all on public.yt_auth from anon, authenticated;

-- papel do usuário: cada um lê só a própria linha.
alter table public.user_roles enable row level security;
drop policy if exists "read own role" on public.user_roles;
create policy "read own role" on public.user_roles
  as permissive for select to authenticated
  using (id::text = (select auth.uid())::text);

do $$
declare t text; p record;
begin
  foreach t in array array[
    'yt_myvideos', 'yt_videos', 'yt_video_metrics_daily', 'yt_video_traffic_details',
    'yt_video_retention_curve', 'yt_links', 'yt_promotions', 'icons', 'icon_files',
    'projects', 'cta_presets', 'custom_links', 'social_presets', 'allowed_users',
    'comment_favorites', 'quick_replies', 'reply_examples'
  ]
  loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "auth_all" on public.%I as permissive for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- O userscript de promoções (Tampermonkey) grava com a chave anon: mantém só o INSERT.
create policy "anon insert (scraper)" on public.yt_promotions
  as permissive for insert to anon with check (true);
