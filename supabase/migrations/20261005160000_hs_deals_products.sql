-- Produtos vendidos vêm dos "itens de linha" do HubSpot (objeto associado ao negócio, não uma
-- propriedade). O sync grava os nomes em hs_deals.products (separados por ';', como item_linha).
alter table public.hs_deals add column if not exists products text;
-- v_deals e v_negocios passam a usar coalesce(hs_deals.products, hubspot_negocios.item_linha)
-- (definições completas reaplicadas na migração 20261005130000 + esta coluna).
