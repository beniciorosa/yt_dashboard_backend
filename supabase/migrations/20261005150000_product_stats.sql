-- Vendas por produto no período (negócios ganhos, fechamento no intervalo). Um negócio com vários
-- itens conta 1 venda em cada produto e divide o valor igualmente entre eles, para a soma bater
-- com a receita total.
create or replace function public.product_stats(p_start date, p_end date)
returns table (product text, won bigint, revenue numeric)
language sql stable
set search_path = public
as $$
    with won as (
        select deal_id, amount,
               array_remove(array(select btrim(x) from unnest(string_to_array(coalesce(products, ''), ';')) x where btrim(x) <> ''), null) as items
        from v_deals
        where is_won and closed_on between p_start and p_end
    )
    select coalesce(nullif(item, ''), 'Sem produto informado') as product,
           count(*) as won,
           coalesce(sum(coalesce(amount, 0) / greatest(cardinality(items), 1)), 0) as revenue
    from won
    left join lateral unnest(case when cardinality(items) = 0 then array['']::text[] else items end) as item on true
    group by 1
    order by revenue desc, won desc
$$;
revoke execute on function public.product_stats(date, date) from public, anon, authenticated;
