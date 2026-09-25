-- No existía policy de DELETE sobre orders: el botón "Eliminar" del panel nunca borraba nada
-- (RLS filtraba la fila y PostgREST respondía sin error). Solo admin/staff pueden eliminar.
drop policy if exists "staff_delete_orders" on public.orders;
create policy "staff_delete_orders" on public.orders
  for delete to authenticated using (public.is_staff());
