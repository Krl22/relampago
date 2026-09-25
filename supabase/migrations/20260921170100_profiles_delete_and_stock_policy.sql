-- Eliminar un motorizado/usuario: los pedidos y entregas conservan el historial sin el vínculo.
alter table public.orders drop constraint if exists orders_assigned_courier_fkey;
alter table public.orders
  add constraint orders_assigned_courier_fkey foreign key (assigned_courier) references public.profiles(id) on delete set null;

alter table public.orders drop constraint if exists orders_created_by_fkey;
alter table public.orders
  add constraint orders_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.deliveries alter column courier_id drop not null;
alter table public.deliveries drop constraint if exists deliveries_courier_id_fkey;
alter table public.deliveries
  add constraint deliveries_courier_id_fkey foreign key (courier_id) references public.profiles(id) on delete set null;

-- Stock: admin/staff gestionan todo; el cliente ve (y edita) solo el de su empresa.
drop policy if exists "Modificar stock de mi empresa" on public.stock;
drop policy if exists "Ver stock de mi empresa" on public.stock;
create policy "staff_manage_stock" on public.stock
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "client_read_own_stock" on public.stock
  for select to authenticated
  using (company_id = (select company_id from public.profiles where id = auth.uid()));
