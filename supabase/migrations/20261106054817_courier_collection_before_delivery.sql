-- Staff retain their correction workflow. Couriers must collect before delivering.
create or replace function private.guard_courier_fulfillment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_pickup_status public.pickup_status;
begin
  if new.status is not distinct from old.status or v_actor is null or public.is_staff() then
    return new;
  end if;
  if not exists (select 1 from public.profiles where id = v_actor and role = 'courier')
     or old.assigned_courier is distinct from v_actor or new.assigned_courier is distinct from v_actor then
    raise exception 'Solo el motorizado asignado puede confirmar este paso' using errcode = '23514';
  end if;

  if old.status = 'pending' then
    if new.origin_type = 'warehouse' then
      if new.status = 'picked_up' then return new; end if;
      raise exception 'Primero confirma el retiro de los paquetes del almacén de Relámpago' using errcode = '23514';
    end if;
    select status into v_pickup_status from public.pickups where id = new.pickup_id for share;
    if v_pickup_status is distinct from 'picked_up'::public.pickup_status then
      raise exception 'Primero completa el recojo del comercio y registra los paquetes recibidos' using errcode = '23514';
    end if;
    if new.status in ('picked_up', 'in_transit') then return new; end if;
  elsif old.status = 'picked_up' and new.status = 'in_transit' then
    return new;
  elsif old.status = 'in_transit' and new.status in ('delivered', 'failed') then
    return new;
  end if;
  raise exception 'Sigue el orden: retiro o recojo, iniciar ruta y confirmar entrega. Contacta a la central para corregir un estado.' using errcode = '23514';
end;
$$;

revoke all on function private.guard_courier_fulfillment() from public, anon, authenticated;
create trigger orders_guard_courier_fulfillment
before update of status on public.orders
for each row execute function private.guard_courier_fulfillment();
