begin;

-- Actual counts stay separate from expected counts. Historical records are not
-- reclassified or linked retroactively by this migration.
alter table public.pickups
  add column received_packages integer not null default 0 check (received_packages >= 0),
  add column auto_generated boolean not null default false;

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.ensure_order_pickup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pickup public.pickups%rowtype;
  v_address public.company_addresses%rowtype;
  v_id uuid;
  v_norm text;
begin
  if tg_op = 'UPDATE' then
    if (new.origin_type, new.company_id, new.scheduled_date, new.pickup_id, new.packages_count)
       is not distinct from
       (old.origin_type, old.company_id, old.scheduled_date, old.pickup_id, old.packages_count) then
      return new;
    end if;
    if auth.uid() is not null and not public.is_staff() then
      raise exception 'Solo la central puede cambiar el origen, comercio, fecha o paquetes del pedido';
    end if;
    if old.pickup_id is not null then
      select * into v_pickup from public.pickups where id = old.pickup_id;
      if v_pickup.received_packages > 0 or v_pickup.status = 'picked_up' then
        raise exception 'El recojo ya tiene paquetes recibidos; no se puede cambiar su origen, fecha o cantidad';
      end if;
    end if;
  end if;

  if new.origin_type <> 'pickup' then
    new.pickup_id := null;
    return new;
  end if;
  if new.company_id is null then raise exception 'Elige un comercio para crear el recojo'; end if;
  if coalesce(new.packages_count, 1) < 1 then raise exception 'El pedido debe tener al menos un paquete'; end if;

  if new.pickup_id is not null then
    select * into v_pickup from public.pickups where id = new.pickup_id for update;
    if v_pickup.id is not null and v_pickup.company_id = new.company_id
       and v_pickup.scheduled_date = new.scheduled_date then
      if v_pickup.status not in ('pending', 'assigned') then
        raise exception 'No se pueden agregar pedidos a un recojo cerrado';
      end if;
      return new;
    end if;
    if v_pickup.company_id = new.company_id then
      select * into v_address from public.company_addresses where id = v_pickup.company_address_id;
    end if;
  end if;
  if v_address.id is null then
    select * into v_address from public.company_addresses
    where company_id = new.company_id
    order by is_default desc, created_at, id limit 1;
  end if;
  if v_address.id is null then
    raise exception 'Este comercio no tiene dirección de recojo registrada. Agrégala en Comercios antes de elegir Recojo';
  end if;
  v_norm := lower(regexp_replace(btrim(v_address.address), '\s+', ' ', 'g'));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'pickup-group:' || new.company_id::text || ':' || new.scheduled_date::text || ':' || v_norm, 0));
  select id into v_id from public.pickups
  where company_id = new.company_id and scheduled_date = new.scheduled_date
    and status in ('pending', 'assigned')
    and lower(regexp_replace(btrim(address), '\s+', ' ', 'g')) = v_norm
  order by created_at, id limit 1 for update;
  if v_id is null then
    insert into public.pickups (
      company_id, company_address_id, address, district, lat, lng,
      contact_name, contact_phone, notes, scheduled_date, packages_count, auto_generated, created_by
    ) values (
      new.company_id, v_address.id, v_address.address, v_address.district, v_address.lat, v_address.lng,
      v_address.contact_name, v_address.contact_phone, v_address.notes,
      new.scheduled_date, 0, true, auth.uid()
    ) returning id into v_id;
  end if;
  new.pickup_id := v_id;
  return new;
end;
$$;
revoke all on function private.ensure_order_pickup() from public, anon, authenticated;

create trigger orders_ensure_pickup
before insert or update of origin_type, company_id, scheduled_date, pickup_id, packages_count on public.orders
for each row execute function private.ensure_order_pickup();

create or replace function private.sync_order_pickup_counts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_expected integer;
  v_orders integer;
begin
  for v_id in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.pickup_id end,
      case when tg_op <> 'DELETE' then new.pickup_id end
    ]) x where x is not null order by x
  loop
    perform 1 from public.pickups where id = v_id for update;
    select count(*), coalesce(sum(coalesce(packages_count, 1)), 0)
      into v_orders, v_expected from public.orders where pickup_id = v_id;
    update public.pickups set
      packages_count = v_expected,
      auto_generated = true,
      status = case when v_orders = 0 and auto_generated and received_packages = 0
        then 'cancelled'::public.pickup_status else status end
    where id = v_id and status in ('pending', 'assigned')
      and (v_orders > 0 or auto_generated);
  end loop;
  return null;
end;
$$;
revoke all on function private.sync_order_pickup_counts() from public, anon, authenticated;
create trigger orders_sync_pickup_counts
after insert or delete or update of origin_type, company_id, scheduled_date, pickup_id, packages_count on public.orders
for each row execute function private.sync_order_pickup_counts();

-- The form/RPC and inline edits share the same group lock. Keep the existing
-- submission validations, stock handling and permissions intact.
do $$
declare
  v_def text := pg_get_functiondef('public.submit_order(jsonb)'::regprocedure);
  v_marker text := '    -- Mismo negocio, misma dirección, mismo día y aún no recogido -> se agrupa';
begin
  if position(v_marker in v_def) = 0 then raise exception 'No se encontró la sección de agrupación de submit_order'; end if;
  v_def := replace(v_def, v_marker,
    '    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(' || E'\n' ||
    '      ''pickup-group:'' || v_company.id::text || '':'' || v_sched::text || '':'' || btrim(v_addr_norm), 0));' || E'\n' || v_marker);
  -- Normalize leading/trailing whitespace consistently with inline edits.
  v_def := replace(v_def, 'regexp_replace(address,', 'regexp_replace(btrim(address),');
  v_def := replace(v_def, 'regexp_replace(v_addr_text,', 'regexp_replace(btrim(v_addr_text),');
  execute v_def;
end;
$$;

-- Serialize receipt updates from multiple couriers and protect already-received
-- packages from reassignment/deletion or silent count decreases.
create or replace function private.guard_pickup_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.pickup_status;
  v_id uuid := case when tg_op = 'DELETE' then old.pickup_id else new.pickup_id end;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pickup-receipt:' || v_id::text, 0));
  if tg_op = 'DELETE' then
    if coalesce(old.packages_count, 0) > 0 and exists(select 1 from public.pickups where id = old.pickup_id) then
      raise exception 'No se puede quitar un motorizado que ya recibió paquetes';
    end if;
    return old;
  end if;
  if new.packages_count is not null and (new.packages_count < 0 or new.packages_count > 10000) then
    raise exception 'La cantidad recibida debe ser un entero entre 0 y 10000';
  end if;
  if tg_op = 'UPDATE' then
    if (new.pickup_id, new.courier_id) is distinct from (old.pickup_id, old.courier_id) then
      raise exception 'No se puede cambiar la identidad de una asignación';
    end if;
    if coalesce(new.packages_count, 0) < coalesce(old.packages_count, 0) then
      raise exception 'El total acumulado no puede ser menor al ya registrado';
    end if;
    if (new.packages_count, new.picked_up_at) is distinct from (old.packages_count, old.picked_up_at) then
      select status into v_status from public.pickups where id = v_id;
      if v_status not in ('pending', 'assigned') then raise exception 'Este recojo ya está cerrado'; end if;
      if new.picked_up_at is not null and new.packages_count is null then
        raise exception 'Indica cuántos paquetes recibiste antes de confirmar';
      end if;
    end if;
    if not public.is_staff() and new.assigned_at is distinct from old.assigned_at then
      raise exception 'Solo la central puede modificar la asignación';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_pickup_receipt() from public, anon, authenticated;
create trigger pickup_assignments_guard_receipt
before insert or update or delete on public.pickup_assignments
for each row execute function private.guard_pickup_receipt();

create or replace function private.sync_pickup_receipts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(new.pickup_id, old.pickup_id);
  v_total integer;
  v_reported integer;
  v_received integer;
begin
  select count(*), count(picked_up_at), coalesce(sum(packages_count) filter (where picked_up_at is not null), 0)
    into v_total, v_reported, v_received from public.pickup_assignments where pickup_id = v_id;
  update public.pickups set
    received_packages = v_received,
    status = case
      when coalesce(packages_count, 0) > 0 and v_received >= packages_count then 'picked_up'::public.pickup_status
      when packages_count is null and v_total > 0 and v_reported = v_total and v_received > 0 then 'picked_up'::public.pickup_status
      when v_total = 0 then 'pending'::public.pickup_status
      else 'assigned'::public.pickup_status
    end
  where id = v_id and status in ('pending', 'assigned');
  return null;
end;
$$;
revoke all on function private.sync_pickup_receipts() from public, anon, authenticated;
drop trigger pickup_assignments_sync_status on public.pickup_assignments;
create trigger pickup_assignments_sync_status
after insert or update or delete on public.pickup_assignments
for each row execute function private.sync_pickup_receipts();

-- Removing empty uncollected groups must not prevent order bulk deletion.
notify pgrst, 'reload schema';
commit;
