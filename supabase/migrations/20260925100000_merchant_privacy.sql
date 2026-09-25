-- Portal del comercio (pedido de los dueños, 2026-09-25):
--   * el comercio no ve quién reparte sus pedidos: solo lee su propio perfil
--   * el comercio no anula ni elimina pedidos: lo gestiona Relámpago
drop policy if exists "read_profiles_by_role" on public.profiles;
create policy "read_profiles_by_role" on public.profiles
  for select to authenticated
  using (public.is_staff() or id = auth.uid());

drop function if exists public.courier_serves_my_company(uuid);
drop function if exists public.cancel_my_order(uuid);
