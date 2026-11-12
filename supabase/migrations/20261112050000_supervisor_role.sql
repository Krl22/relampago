-- Rol Supervisor (valor 'staff'): opera el día a día sin acciones destructivas ni de configuración.
--   Puede: ver todo; crear y editar pedidos, comercios, recojos y stock; asignar motorizados;
--          completar entregas; generar liquidaciones.
--   No puede (solo admin): eliminar pedidos, comercios, stock o liquidaciones; crear, editar o
--          eliminar cuentas y roles; cambiar condiciones de tarifa de un comercio, distritos o
--          configuración; marcar liquidaciones como pagadas.
-- "Ver como", el asistente y el borrado masivo / respaldo de pedidos ya eran solo de admin.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- Pedidos: solo admin elimina ------------------------------------------------
drop policy if exists "staff_delete_orders" on public.orders;
drop policy if exists "admin_delete_orders" on public.orders;
create policy "admin_delete_orders" on public.orders for delete to authenticated using (public.is_admin());

-- Perfiles: crear, editar (incluye el rol) y eliminar cuentas, solo admin -------
drop policy if exists "Allow admin and staff to insert profiles" on public.profiles;
drop policy if exists "Allow admin and staff to update profiles" on public.profiles;
drop policy if exists "Allow admin and staff to delete profiles" on public.profiles;
drop policy if exists "admin_insert_profiles" on public.profiles;
drop policy if exists "admin_update_profiles" on public.profiles;
drop policy if exists "admin_delete_profiles" on public.profiles;
create policy "admin_insert_profiles" on public.profiles for insert to authenticated with check (public.is_admin());
create policy "admin_update_profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin_delete_profiles" on public.profiles for delete to authenticated using (public.is_admin());

-- Comercios: el supervisor crea y edita; solo admin elimina ----------------------
drop policy if exists "staff_manage_companies" on public.companies;
drop policy if exists "staff_insert_companies" on public.companies;
drop policy if exists "staff_update_companies" on public.companies;
drop policy if exists "admin_delete_companies" on public.companies;
create policy "staff_insert_companies" on public.companies for insert to authenticated with check (public.is_staff());
create policy "staff_update_companies" on public.companies for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "admin_delete_companies" on public.companies for delete to authenticated using (public.is_admin());

-- Condiciones de tarifa del comercio (IGV y tarifa T1 especial): solo admin
create or replace function public.guard_company_pricing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.t1_rate is not null or coalesce(new.invoice_igv, false) then
      raise exception 'Solo un administrador puede definir las condiciones de tarifa del comercio';
    end if;
  elsif new.t1_rate is distinct from old.t1_rate or new.invoice_igv is distinct from old.invoice_igv then
    raise exception 'Solo un administrador puede cambiar las condiciones de tarifa del comercio';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_company_pricing() from public, anon, authenticated;
drop trigger if exists companies_guard_pricing on public.companies;
create trigger companies_guard_pricing before insert or update on public.companies
  for each row execute function public.guard_company_pricing();

-- Distritos / tarifas y configuración: solo admin cambia --------------------------
drop policy if exists "staff_manage_districts" on public.districts;
drop policy if exists "admin_manage_districts" on public.districts;
create policy "admin_manage_districts" on public.districts for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff_manage_app_settings" on public.app_settings;
drop policy if exists "admin_manage_app_settings" on public.app_settings;
drop policy if exists "staff_read_app_settings" on public.app_settings;
create policy "admin_manage_app_settings" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "staff_read_app_settings" on public.app_settings for select to authenticated using (public.is_staff());

-- Stock: el supervisor registra ingresos y ajustes; solo admin elimina -------------
drop policy if exists "staff_manage_stock" on public.stock;
drop policy if exists "staff_read_stock" on public.stock;
drop policy if exists "staff_insert_stock" on public.stock;
drop policy if exists "staff_update_stock" on public.stock;
drop policy if exists "admin_delete_stock" on public.stock;
create policy "staff_read_stock" on public.stock for select to authenticated using (public.is_staff());
create policy "staff_insert_stock" on public.stock for insert to authenticated with check (public.is_staff());
create policy "staff_update_stock" on public.stock for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "admin_delete_stock" on public.stock for delete to authenticated using (public.is_admin());

-- Liquidaciones: el supervisor las genera; solo admin las paga o elimina -------------
drop policy if exists "staff_manage_settlements" on public.settlements;
drop policy if exists "staff_read_settlements" on public.settlements;
drop policy if exists "staff_insert_settlements" on public.settlements;
drop policy if exists "staff_update_settlements" on public.settlements;
drop policy if exists "admin_delete_settlements" on public.settlements;
create policy "staff_read_settlements" on public.settlements for select to authenticated using (public.is_staff());
create policy "staff_insert_settlements" on public.settlements for insert to authenticated with check (public.is_staff());
create policy "staff_update_settlements" on public.settlements for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "admin_delete_settlements" on public.settlements for delete to authenticated using (public.is_admin());

create or replace function public.guard_settlement_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.paid_at is not null then raise exception 'Solo un administrador puede marcar una liquidación como pagada'; end if;
  elsif new.paid_at is distinct from old.paid_at or new.paid_reference is distinct from old.paid_reference then
    raise exception 'Solo un administrador puede marcar una liquidación como pagada';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_settlement_payment() from public, anon, authenticated;
drop trigger if exists settlements_guard_payment on public.settlements;
create trigger settlements_guard_payment before insert or update on public.settlements
  for each row execute function public.guard_settlement_payment();
