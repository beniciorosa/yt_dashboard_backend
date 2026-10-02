-- UTMs (como aparecem nos negócios, sem normalizar) → vídeo, já com a atribuição completa
-- (link, videoId no slug e vínculo manual). É a fonte única usada pelas telas de Vendas.
create or replace function public.attribution_utm_map()
returns table (utm_content text, video_id text)
language sql stable
set search_path = public
as $$
    select distinct d.utm_content, a.video_id
    from v_deal_attribution a
    join hubspot_negocios d on d.negocio_id = a.deal_id
    where a.video_id is not null and d.utm_content is not null
$$;
revoke execute on function public.attribution_utm_map() from public, anon, authenticated;
