-- Vendas da Hotmart (Metrify e demais produtos), lidas direto da API pelo backend.
-- Fica separado do HubSpot: o app mostra os dois lado a lado, sem somar.
create table if not exists public.hotmart_sales (
    transaction text primary key,
    product_id bigint,
    product_name text,
    offer_code text,
    buyer_name text,
    buyer_email text,
    status text not null,
    order_date timestamptz,
    approved_date timestamptz,
    price numeric,                -- valor pago pelo comprador
    currency text,
    hotmart_fee numeric,          -- taxa da Hotmart (purchase.hotmart_fee.total)
    producer_net numeric,         -- comissão do produtor (sales/commissions, source = PRODUCER)
    payment_type text,
    installments int,
    is_subscription boolean,
    recurrency_number int,
    source_sck text,
    updated_at timestamptz not null default now()
);
create index if not exists hotmart_sales_approved_idx on public.hotmart_sales (approved_date);
create index if not exists hotmart_sales_product_idx on public.hotmart_sales (product_name);

create table if not exists public.hotmart_sync_state (
    id int primary key default 1 check (id = 1),
    -- janela mais antiga já coberta pelo backfill (anda para trás até não haver mais vendas)
    backfill_until timestamptz,
    backfill_done boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.hotmart_sales enable row level security;
alter table public.hotmart_sync_state enable row level security;

-- Métricas do período (datas em America/Sao_Paulo pela data de aprovação), com filtro por nome do produto.
create or replace function public.hotmart_metrics(p_start date, p_end date, p_product text default null)
returns jsonb
language sql stable
set search_path = public
as $$
    with base as (
        select *, (approved_date at time zone 'America/Sao_Paulo')::date as day
        from hotmart_sales
        where approved_date is not null
          and (p_product is null or product_name ilike '%' || p_product || '%')
          and (approved_date at time zone 'America/Sao_Paulo')::date between p_start and p_end
    ),
    paid as (select * from base where status in ('APPROVED', 'COMPLETE')),
    refunded as (select * from base where status in ('REFUNDED', 'CHARGEBACK', 'PARTIALLY_REFUNDED'))
    select jsonb_build_object(
        'count', (select count(*) from paid),
        'gross', (select coalesce(sum(price), 0) from paid),
        'fees', (select coalesce(sum(hotmart_fee), 0) from paid),
        'net', (select coalesce(sum(coalesce(producer_net, price - coalesce(hotmart_fee, 0))), 0) from paid),
        'refunds', (select count(*) from refunded),
        'refundedGross', (select coalesce(sum(price), 0) from refunded),
        'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'count', d.n, 'gross', d.gross, 'net', d.net) order by d.day), '[]'::jsonb)
                  from (select day, count(*) n, sum(price) gross, sum(coalesce(producer_net, price - coalesce(hotmart_fee, 0))) net from paid group by day) d),
        'products', (select coalesce(jsonb_agg(jsonb_build_object('product', p.product_name, 'count', p.n, 'gross', p.gross, 'net', p.net) order by p.gross desc), '[]'::jsonb)
                     from (select coalesce(product_name, 'Sem nome') product_name, count(*) n, sum(price) gross, sum(coalesce(producer_net, price - coalesce(hotmart_fee, 0))) net from paid group by 1) p)
    )
$$;
revoke execute on function public.hotmart_metrics(date, date, text) from public, anon, authenticated;

-- Sync a cada hora (incremental; cada chamada cabe nos 60 s da função).
select cron.schedule('sync-hotmart', '15 * * * *', $$
    select net.http_get(
        url := 'https://yt-dashboard-backend.vercel.app/api/hotmart/sync',
        headers := jsonb_build_object('x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')),
        timeout_milliseconds := 60000)
$$);
