-- =====================================================================
--  security_rls_fix.sql
--  Correção das falhas de segurança apontadas pelo Supabase advisor
--  Projeto: yt_dashboard  (ref qytuhvqggsleohxndtqz)
--
--  Base da decisão (auditoria do código real, jun/2026):
--    * FRONTEND  (yt_dashboard_frontend) usa a ANON KEY **com login**
--      (Supabase Auth: signInWithPassword / OAuth). Logo auth.uid() existe
--      e o modelo "somente autenticado" preserva o comportamento atual.
--    * BACKEND   (yt_dashboard_backend, NestJS) usa a SERVICE_ROLE key,
--      que **IGNORA RLS**. => Nada aqui afeta o backend.
--    * SidebarWindows usa só as tabelas sidebar_* (já com RLS correto).
--
--  Modelo aplicado: bloquear o acesso ANÔNIMO (o buraco real) sem quebrar
--  o app. Usuários logados continuam enxergando tudo, exatamente como hoje
--  (o front faz "SELECT * sem filtro de user_id" de propósito - ver
--  loadProjects()). Isolar por usuário é OPCIONAL e exigiria mudar o app
--  (re-adicionar filtros user_id) -> ver a seção OPCIONAL no fim.
--
--  >>> APLIQUE PRIMEIRO EM UMA BRANCH DO SUPABASE, se possível. <<<
--  Tudo roda numa transação: se algo falhar, faz ROLLBACK inteiro.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) CRÍTICO -- yt_auth: refresh_token do YouTube vazando para anon.
--    O frontend NUNCA lê essa tabela; só o backend (service_role).
--    RLS ligado + ZERO policy => ninguém além do service_role acessa.
-- ---------------------------------------------------------------------
alter table public.yt_auth enable row level security;
revoke all on public.yt_auth from anon, authenticated;   -- defesa extra (corta o acesso via API)

-- ---------------------------------------------------------------------
-- 2) Tabelas com RLS DESLIGADO -> ligar RLS + policy "somente autenticado".
--    (front lê/escreve essas como usuário logado; back via service_role)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'yt_video_metrics_daily',
    'yt_video_traffic_details',
    'yt_video_retention_curve',
    'icons',
    'icon_files',
    'ultima_data'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "auth_all" on public.%I', t);
    execute format(
      'create policy "auth_all" on public.%I as permissive for all to authenticated using (true) with check (true)',
      t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) user_roles: caso especial. O front só lê A PRÓPRIA linha
--    (App.tsx: .from(user_roles).select(role).eq(id, userId).single()).
--    Então restringimos a leitura à própria linha (não vaza e-mail/role
--    dos outros). Inserção/alteração já é feita pelo backend (service_role).
-- ---------------------------------------------------------------------
alter table public.user_roles enable row level security;
drop policy if exists "read own role" on public.user_roles;
create policy "read own role" on public.user_roles
  as permissive for select to authenticated
  using ( id::text = (select auth.uid())::text );

-- ---------------------------------------------------------------------
-- 4) Tabelas com RLS LIGADO mas policy permissiva USING(true) TO public
--    (criadas pelo antigo fix_rls_policies.sql). Trocamos public->authenticated.
--    Removemos TODAS as policies atuais da tabela e criamos a correta.
-- ---------------------------------------------------------------------
do $$
declare t text; p record;
begin
  foreach t in array array[
    'cta_presets',
    'custom_links',
    'projects',
    'social_presets',
    'yt_links',
    'yt_promotions',
    'allowed_users',
    -- backend-only (NestJS via service_role); front não acessa direto.
    -- Mantidas como 'authenticated' por segurança/consistência; se quiser
    -- o nível mais estrito, troque por service_role-only (sem policy).
    'comment_favorites',
    'quick_replies',
    'reply_examples'
  ]
  loop
    -- remove as policies permissivas existentes (as USING(true) TO public)
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "auth_all" on public.%I as permissive for all to authenticated using (true) with check (true)',
      t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5) Funções SECURITY DEFINER executáveis por anon. O frontend não chama
--    nenhuma via .rpc(); o backend usa service_role. Revoga de anon/public.
--    (resolve as assinaturas sozinho, inclusive sobrecargas)
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_last_update','get_ultima_data_negocio','handle_new_user','upsert_negocios')
  loop
    execute format('revoke execute on function public.%I(%s) from anon, public', f.proname, f.args);
  end loop;
end $$;

commit;

-- =====================================================================
-- 6) BUCKET temp-uploads  (rodar APÓS revisar - NÃO está na transação acima)
--    O app usa createSignedUrl (funciona em bucket PRIVADO), então dá pra
--    privar o bucket e impedir a listagem/leitura anônima de todos os arquivos.
--    ATENÇÃO: NÃO dê "drop policy" cego em storage.objects - isso afeta os
--    outros buckets (sidebar-icons, sidebar-attachments...). Rode primeiro:
--
--      select policyname, cmd, roles, qual
--      from pg_policies
--      where schemaname='storage' and tablename='objects';
--
--    Identifique as policies amplas do temp-uploads e remova só elas pelo nome.
--    Depois aplique o modelo por-usuário (pasta = auth.uid()):
-- ---------------------------------------------------------------------
-- update storage.buckets set public = false where id = 'temp-uploads';
--
-- create policy "temp own upload" on storage.objects
--   for insert to authenticated
--   with check ( bucket_id = 'temp-uploads'
--                and (storage.foldername(name))[1] = (select auth.uid())::text );
--
-- create policy "temp own read" on storage.objects
--   for select to authenticated
--   using ( bucket_id = 'temp-uploads'
--           and (storage.foldername(name))[1] = (select auth.uid())::text );
--
-- (Signed URLs continuam funcionando para o OpenAI/Whisper buscar o arquivo,
--  mesmo com o bucket privado.)

-- =====================================================================
-- 7) AUTH (não é SQL) - ligar no painel:
--    Authentication > Providers/Policies > "Leaked password protection".
-- =====================================================================

-- =====================================================================
-- OPCIONAL - Isolamento por usuário (mais seguro, MAS muda comportamento)
--   Hoje o app mostra TODOS os projetos/presets a qualquer usuário logado
--   (loadProjects removeu o filtro user_id de propósito). Para isolar por
--   usuário, troque a policy "auth_all" das tabelas com user_id por:
--
--     create policy "owner_all" on public.projects
--       as permissive for all to authenticated
--       using ( user_id = (select auth.uid())::text )
--       with check ( user_id = (select auth.uid())::text );
--
--   (idem cta_presets, custom_links, social_presets - todas têm user_id TEXT)
--   E reativar os filtros .eq('user_id', ...) no frontend (descriptionStorage.ts).
-- =====================================================================

-- =====================================================================
-- ROLLBACK manual (se precisar reabrir algo às pressas):
--   alter table public.<tabela> disable row level security;   -- volta ao estado inseguro
-- Ou recrie a policy antiga:  ... for all to public using (true) ...
-- =====================================================================
