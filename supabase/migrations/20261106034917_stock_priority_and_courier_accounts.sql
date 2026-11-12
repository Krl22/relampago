-- Priority is derived from registered inventory, including products currently at zero.
-- Courier duties require a separate Auth identity with role=courier.
create schema if not exists private;

create or replace function private.derive_company_stock_priority()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.skip_cutoff := exists(select 1 from public.stock where company_id=new.id);
  return new;
end;
$$;
revoke all on function private.derive_company_stock_priority() from public,anon,authenticated;

create trigger companies_stock_priority
before insert or update of skip_cutoff on public.companies
for each row execute function private.derive_company_stock_priority();

create or replace function private.refresh_stock_company_priority()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_company uuid; new_company uuid;
begin
  if tg_op <> 'INSERT' then old_company:=old.company_id; end if;
  if tg_op <> 'DELETE' then new_company:=new.company_id; end if;
  -- Serialize changes for the affected commerce without blocking unrelated commerces.
  perform id from public.companies where id in(old_company,new_company) order by id for no key update;
  update public.companies c
    set skip_cutoff=exists(select 1 from public.stock s where s.company_id=c.id)
    where c.id in(old_company,new_company)
      and c.skip_cutoff is distinct from exists(select 1 from public.stock s where s.company_id=c.id);
  return null;
end;
$$;
revoke all on function private.refresh_stock_company_priority() from public,anon,authenticated;
create trigger stock_company_priority
after insert or delete or update of company_id on public.stock
for each row execute function private.refresh_stock_company_priority();

update public.companies c
set skip_cutoff=exists(select 1 from public.stock s where s.company_id=c.id)
where c.skip_cutoff is distinct from exists(select 1 from public.stock s where s.company_id=c.id);
comment on column public.companies.skip_cutoff is 'Prioridad automática: existe inventario registrado para el comercio, incluso con saldo cero.';

create or replace function public.sync_is_courier()
returns trigger language plpgsql set search_path='' as $$
begin
  new.is_courier := new.role='courier';
  return new;
end;
$$;
revoke all on function public.sync_is_courier() from public,anon,authenticated;
update public.profiles set is_courier=(role='courier') where is_courier is distinct from (role='courier');

create or replace function private.require_courier_account()
returns trigger language plpgsql security definer set search_path='' as $$
declare courier uuid;
begin
  if tg_table_name='orders' then
    if tg_op='UPDATE' and new.assigned_courier is not distinct from old.assigned_courier then return new; end if;
    courier:=new.assigned_courier;
  else
    courier:=new.courier_id;
  end if;
  if courier is not null and not exists(select 1 from public.profiles where id=courier and role='courier') then
    raise exception 'Selecciona una cuenta de motorizado. Las cuentas administrativas no realizan repartos.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.require_courier_account() from public,anon,authenticated;
create trigger orders_require_courier_account before insert or update of assigned_courier on public.orders
for each row execute function private.require_courier_account();
create trigger pickup_assignments_require_courier_account before insert or update of courier_id on public.pickup_assignments
for each row execute function private.require_courier_account();
create trigger courier_locations_require_courier_account before insert or update on public.courier_locations
for each row execute function private.require_courier_account();
notify pgrst,'reload schema';
