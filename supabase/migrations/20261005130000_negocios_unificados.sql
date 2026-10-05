-- Mesma forma de hubspot_negocios, mas com o sync direto (hs_deals) em primeiro lugar e a tabela
-- da automação externa só para o que o sync ainda não cobre. As telas de Vendas leem daqui,
-- então passam a ver os negócios que a automação deixou de entregar.
-- Datas continuam em UTC sem fuso, como em hubspot_negocios.
create or replace view public.v_negocios with (security_invoker = true) as
select
    h.deal_id as negocio_id,
    h.name as negocio_nome,
    o.name as proprietario,
    case s.kind
        when 'won' then 'Negócio ganho'
        when 'lost' then 'Negócio perdido'
        else coalesce(s.label || ' (' || s.pipeline_label || ')', n.etapa)
    end as etapa,
    (h.created_at at time zone 'UTC')::timestamp as data_criacao,
    (h.closed_at at time zone 'UTC')::timestamp as data_fechamento,
    coalesce(h.lost_reason, n.motivo) as motivo,
    n.localizacao,
    n.cep,
    n.uf_padrao,
    n.item_linha,
    h.amount as valor,
    h.utm_campaign,
    h.utm_content,
    h.utm_medium,
    h.utm_source,
    h.utm_term,
    (h.modified_at at time zone 'UTC')::timestamp as last_update,
    false as deleted
from public.hs_deals h
left join public.hs_stages s on s.stage_id = h.stage_id
left join public.hs_owners o on o.owner_id = h.owner_id
left join public.hubspot_negocios n on n.negocio_id = h.deal_id
union all
select
    d.negocio_id, d.negocio_nome, d.proprietario, d.etapa, d.data_criacao, d.data_fechamento, d.motivo,
    d.localizacao, d.cep, d.uf_padrao, d.item_linha, d.valor,
    d.utm_campaign, d.utm_content, d.utm_medium, d.utm_source, d.utm_term, d.last_update, d.deleted
from public.hubspot_negocios d
where coalesce(d.deleted, false) = false
  and not exists (select 1 from public.hs_deals h where h.deal_id = d.negocio_id);

revoke all on public.v_negocios from anon, authenticated;

-- o mapa UTM→vídeo das telas de Vendas também passa a enxergar o sync direto
create or replace function public.attribution_utm_map()
returns table (utm_content text, video_id text)
language sql stable
set search_path = public
as $$
    select distinct d.utm_content, a.video_id
    from v_deal_attribution a
    join v_negocios d on d.negocio_id = a.deal_id
    where a.video_id is not null and d.utm_content is not null
$$;
revoke execute on function public.attribution_utm_map() from public, anon, authenticated;
