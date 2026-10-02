-- Atribuição de vendas (HubSpot → vídeo) e estatísticas de closers.
-- Tudo aditivo: hubspot_negocios (alimentada pela automação externa) e yt_links não mudam.

-- ---------------------------------------------------------------------------
-- 1. Espelho enriquecido do HubSpot (preenchido pelo sync do backend)
-- ---------------------------------------------------------------------------
create table if not exists public.hs_owners (
    owner_id bigint primary key,
    name text not null,
    email text,
    active boolean not null default true,
    -- papel comercial, editável na UI; null = ainda não classificado
    role text check (role in ('closer', 'sdr', 'outro')),
    updated_at timestamptz not null default now()
);

create table if not exists public.hs_stages (
    stage_id text primary key,
    pipeline_id text not null,
    pipeline_label text not null,
    label text not null,
    display_order int not null default 0,
    -- Os IDs de estágio deste portal enganam (closedwon = "Link de pagamento enviado",
    -- closedlost = "Negócio ganho"), então o significado vem desta coluna, nunca do ID.
    kind text not null default 'open' check (kind in ('open', 'meeting_scheduled', 'meeting_held', 'won', 'lost')),
    -- true quando alguém ajustou o kind à mão: o sync não sobrescreve
    kind_locked boolean not null default false
);

create table if not exists public.hs_deals (
    deal_id bigint primary key,
    name text,
    pipeline_id text,
    stage_id text,
    owner_id bigint,
    amount numeric,
    created_at timestamptz,
    closed_at timestamptz,
    utm_content text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    lost_reason text,
    meeting_scheduled_at timestamptz,
    meeting_held_at timestamptz,
    modified_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists hs_deals_owner_idx on public.hs_deals (owner_id);
create index if not exists hs_deals_modified_idx on public.hs_deals (modified_at);

-- cursor do sync incremental (linha única)
create table if not exists public.hs_sync_state (
    id int primary key default 1 check (id = 1),
    modified_cursor timestamptz,
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Vínculo manual de UTMs que não batem com nenhum link (ex.: "yt-video0808")
-- ---------------------------------------------------------------------------
create table if not exists public.utm_aliases (
    utm_content text primary key check (utm_content = lower(btrim(utm_content))),
    video_id text,
    -- destino que não é um vídeo específico (ex.: "Link fixo do canal")
    bucket text,
    note text,
    created_at timestamptz not null default now(),
    check (video_id is not null or bucket is not null)
);

-- ---------------------------------------------------------------------------
-- 3. Tipos de vídeo (taxonomia editável; a IA sugere, a pessoa corrige)
-- ---------------------------------------------------------------------------
create table if not exists public.video_types (
    id bigint generated always as identity primary key,
    dimension text not null check (dimension in ('tema', 'formato', 'publico', 'produto')),
    name text not null,
    description text,
    created_at timestamptz not null default now(),
    unique (dimension, name)
);

create table if not exists public.video_type_assignments (
    video_id text not null,
    dimension text not null,
    type_id bigint not null references public.video_types (id) on delete cascade,
    source text not null default 'ia' check (source in ('ia', 'manual')),
    model text,
    updated_at timestamptz not null default now(),
    primary key (video_id, dimension)
);

alter table public.hs_owners enable row level security;
alter table public.hs_stages enable row level security;
alter table public.hs_deals enable row level security;
alter table public.hs_sync_state enable row level security;
alter table public.utm_aliases enable row level security;
alter table public.video_types enable row level security;
alter table public.video_type_assignments enable row level security;
-- sem policies: só o backend (service_role) lê e grava.

create index if not exists hubspot_negocios_utm_norm_idx on public.hubspot_negocios (lower(btrim(utm_content)));
create index if not exists yt_links_utm_norm_idx on public.yt_links (lower(btrim(utm_content)));

-- ---------------------------------------------------------------------------
-- 4. Visões
-- ---------------------------------------------------------------------------

-- Todos os negócios, com o enriquecimento do sync quando existir.
create or replace view public.v_deals with (security_invoker = true) as
select
    d.negocio_id as deal_id,
    d.negocio_nome as name,
    nullif(lower(btrim(d.utm_content)), '') as utm,
    coalesce(o.name, nullif(btrim(d.proprietario), '')) as owner_name,
    h.owner_id,
    o.role as owner_role,
    coalesce(h.amount, d.valor) as amount,
    d.data_criacao::date as created_on,
    d.data_fechamento::date as closed_on,
    coalesce(s.kind = 'won', d.etapa ~* '(ganho|fechado)' and d.etapa !~* 'perdido', false) as is_won,
    coalesce(s.kind = 'lost', d.etapa ~* '(perdido|lost)', false) as is_lost,
    coalesce(s.label, d.etapa) as stage_label,
    (h.meeting_scheduled_at at time zone 'America/Sao_Paulo')::date as meeting_scheduled_on,
    (h.meeting_held_at at time zone 'America/Sao_Paulo')::date as meeting_held_on,
    d.item_linha as products,
    d.uf_padrao as uf,
    coalesce(h.lost_reason, d.motivo) as lost_reason,
    h.deal_id is not null as enriched
from public.hubspot_negocios d
left join public.hs_deals h on h.deal_id = d.negocio_id
left join public.hs_stages s on s.stage_id = h.stage_id
left join public.hs_owners o on o.owner_id = h.owner_id
where coalesce(d.deleted, false) = false;

-- Negócios do YouTube e o vídeo ao qual cada um é atribuído.
-- Ordem de precedência: vínculo manual > link cadastrado > videoId embutido no slug.
create or replace view public.v_deal_attribution with (security_invoker = true) as
with links as (
    select distinct on (lower(btrim(utm_content)))
        lower(btrim(utm_content)) as utm, video_id
    from public.yt_links
    where utm_content is not null and video_id is not null
    order by lower(btrim(utm_content)), created_at desc
),
vids as (
    select video_id, lower(video_id) as lv from public.yt_myvideos
)
select
    d.deal_id,
    d.utm,
    coalesce(a.video_id, l.video_id, v_mid.video_id, v_end.video_id) as video_id,
    case
        when a.video_id is not null then 'alias'
        when a.bucket is not null then 'bucket'
        when l.utm is not null then 'link'
        when v_mid.video_id is not null or v_end.video_id is not null then 'slug'
        else 'unattributed'
    end as method,
    a.bucket
from public.v_deals d
left join public.utm_aliases a on a.utm_content = d.utm
left join links l on l.utm = d.utm
-- slug novo: yt-DDMMAA-<videoId>-...   slug antigo: yt-DDMMAA-...-<videoId>
left join vids v_mid on v_mid.lv = substring(d.utm from 11 for 11)
left join vids v_end on v_end.lv = right(d.utm, 11)
where d.utm like 'yt-%' or l.utm is not null or a.utm_content is not null;

-- ---------------------------------------------------------------------------
-- 5. Funções de leitura (agregam no banco; o PostgREST corta respostas em 1000 linhas)
-- ---------------------------------------------------------------------------

-- Data de publicação escrita no slug (yt-DDMMAA-...); null quando não há data válida.
create or replace function public.slug_date(p_utm text)
returns date
language plpgsql immutable
set search_path = public
as $$
begin
    if p_utm !~ '^yt-\d{6}' then return null; end if;
    return to_date(substring(p_utm from 4 for 6), 'DDMMYY');
exception when others then
    return null;
end $$;

create or replace function public.attribution_coverage()
returns table (method text, deals bigint, won bigint, revenue numeric)
language sql stable
set search_path = public
as $$
    select a.method, count(*), count(*) filter (where d.is_won), coalesce(sum(d.amount) filter (where d.is_won), 0)
    from v_deal_attribution a
    join v_deals d using (deal_id)
    group by a.method
$$;

create or replace function public.attribution_orphans()
returns table (utm text, deals bigint, won bigint, revenue numeric, first_deal date, last_deal date, candidates jsonb)
language sql stable
set search_path = public
as $$
    with orphans as (
        select a.utm, count(*) as deals, count(*) filter (where d.is_won) as won,
               coalesce(sum(d.amount) filter (where d.is_won), 0) as revenue,
               min(d.created_on) as first_deal, max(d.created_on) as last_deal,
               slug_date(a.utm) as slug_date
        from v_deal_attribution a
        join v_deals d using (deal_id)
        where a.method = 'unattributed'
        group by a.utm
    )
    select o.utm, o.deals, o.won, o.revenue, o.first_deal, o.last_deal,
           coalesce((
               select jsonb_agg(jsonb_build_object('video_id', v.video_id, 'title', v.title, 'thumbnail_url', v.thumbnail_url, 'published_at', v.published_at)
                                order by v.published_at)
               from yt_myvideos v
               where o.slug_date is not null
                 and (v.published_at at time zone 'America/Sao_Paulo')::date between o.slug_date - 1 and o.slug_date + 1
           ), '[]'::jsonb)
    from orphans o
    order by o.revenue desc, o.deals desc
$$;

-- Desempenho por dono do negócio. p_scope: 'youtube' = só negócios atribuídos a vídeo/bucket; 'all' = todos.
-- Leads contam pela data de criação; ganhos/perdas pela data de fechamento.
create or replace function public.closer_stats(p_start date, p_end date, p_scope text default 'youtube')
returns table (
    owner_name text, owner_id bigint, owner_role text,
    leads bigint, won bigint, lost bigint, revenue numeric, avg_cycle_days numeric,
    meetings_scheduled bigint, meetings_held bigint, enriched_deals bigint
)
language sql stable
set search_path = public
as $$
    -- A atribuição é materializada uma vez e unida por join: com "p_scope = 'all' OR deal_id IN (...)"
    -- o plano genérico da função reavaliava a subconsulta por negócio (35 s).
    with attributed as materialized (
        select distinct deal_id from v_deal_attribution where method <> 'unattributed'
    ),
    scoped as (
        select d.* from v_deals d where p_scope = 'all'
        union all
        select d.* from v_deals d join attributed a using (deal_id) where p_scope <> 'all'
    )
    select
        coalesce(owner_name, 'Sem proprietário'),
        max(owner_id),
        max(owner_role),
        count(*) filter (where created_on between p_start and p_end),
        count(*) filter (where is_won and closed_on between p_start and p_end),
        count(*) filter (where is_lost and closed_on between p_start and p_end),
        coalesce(sum(amount) filter (where is_won and closed_on between p_start and p_end), 0),
        round(avg(closed_on - created_on) filter (where is_won and closed_on between p_start and p_end), 1),
        count(*) filter (where meeting_scheduled_on between p_start and p_end),
        count(*) filter (where meeting_held_on between p_start and p_end),
        count(*) filter (where enriched and created_on between p_start and p_end)
    from scoped
    group by coalesce(owner_name, 'Sem proprietário')
$$;

-- Cruzamento dono × tipo de vídeo (uma dimensão por vez), sobre negócios fechados no período.
create or replace function public.closer_type_matrix(p_start date, p_end date, p_dimension text)
returns table (owner_name text, type_id bigint, type_name text, closed bigint, won bigint, revenue numeric)
language sql stable
set search_path = public
as $$
    select coalesce(d.owner_name, 'Sem proprietário'), t.id, t.name,
           count(*), count(*) filter (where d.is_won), coalesce(sum(d.amount) filter (where d.is_won), 0)
    from v_deal_attribution a
    join v_deals d using (deal_id)
    join video_type_assignments ta on ta.video_id = a.video_id and ta.dimension = p_dimension
    join video_types t on t.id = ta.type_id
    where (d.is_won or d.is_lost) and d.closed_on between p_start and p_end
    group by coalesce(d.owner_name, 'Sem proprietário'), t.id, t.name
$$;

revoke execute on function public.slug_date(text) from public, anon, authenticated;
revoke execute on function public.attribution_coverage() from public, anon, authenticated;
revoke execute on function public.attribution_orphans() from public, anon, authenticated;
revoke execute on function public.closer_stats(date, date, text) from public, anon, authenticated;
revoke execute on function public.closer_type_matrix(date, date, text) from public, anon, authenticated;
revoke all on public.v_deals, public.v_deal_attribution from anon, authenticated;
