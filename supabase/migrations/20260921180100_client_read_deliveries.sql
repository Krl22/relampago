-- El comercio ve la evidencia (foto) de la entrega de sus pedidos.
drop policy if exists "client_read_own_deliveries" on public.deliveries;
create policy "client_read_own_deliveries" on public.deliveries
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = deliveries.order_id and o.company_id = public.my_company_id()
  ));
