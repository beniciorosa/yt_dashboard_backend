-- 1) As colunas data_criacao/data_fechamento de hubspot_negocios são gravadas em UTC (sem fuso):
--    as datas de calendário passam a ser convertidas para America/Sao_Paulo, como o HubSpot mostra.
-- 2) hs_deals (sync direto, quando ligado) vira a fonte principal: a automação externa que alimenta
--    hubspot_negocios deixou de entregar negócios ganhos a partir de 02/10/2026. Negócios que só
--    existem em hubspot_negocios continuam entrando.
create or replace view public.v_deals with (security_invoker = true) as
with direct as (
    select
        h.deal_id,
        h.name,
        nullif(lower(btrim(h.utm_content)), '') as utm,
        o.name as owner_name,
        h.owner_id,
        o.role as owner_role,
        h.amount,
        (h.created_at at time zone 'America/Sao_Paulo')::date as created_on,
        (h.closed_at at time zone 'America/Sao_Paulo')::date as closed_on,
        coalesce(s.kind = 'won', false) as is_won,
        coalesce(s.kind = 'lost', false) as is_lost,
        s.label as stage_label,
        (h.meeting_scheduled_at at time zone 'America/Sao_Paulo')::date as meeting_scheduled_on,
        (h.meeting_held_at at time zone 'America/Sao_Paulo')::date as meeting_held_on,
        n.item_linha as products,
        n.uf_padrao as uf,
        coalesce(h.lost_reason, n.motivo) as lost_reason,
        true as enriched
    from public.hs_deals h
    left join public.hs_stages s on s.stage_id = h.stage_id
    left join public.hs_owners o on o.owner_id = h.owner_id
    left join public.hubspot_negocios n on n.negocio_id = h.deal_id
),
legacy as (
    select
        d.negocio_id as deal_id,
        d.negocio_nome as name,
        nullif(lower(btrim(d.utm_content)), '') as utm,
        nullif(btrim(d.proprietario), '') as owner_name,
        null::bigint as owner_id,
        null::text as owner_role,
        d.valor as amount,
        (d.data_criacao at time zone 'UTC' at time zone 'America/Sao_Paulo')::date as created_on,
        (d.data_fechamento at time zone 'UTC' at time zone 'America/Sao_Paulo')::date as closed_on,
        coalesce(d.etapa ~* '(ganho|fechado)' and d.etapa !~* 'perdido', false) as is_won,
        coalesce(d.etapa ~* '(perdido|lost)', false) as is_lost,
        d.etapa as stage_label,
        null::date as meeting_scheduled_on,
        null::date as meeting_held_on,
        d.item_linha as products,
        d.uf_padrao as uf,
        d.motivo as lost_reason,
        false as enriched
    from public.hubspot_negocios d
    where coalesce(d.deleted, false) = false
      and not exists (select 1 from public.hs_deals h where h.deal_id = d.negocio_id)
)
select * from direct
union all
select * from legacy;

revoke all on public.v_deals from anon, authenticated;
