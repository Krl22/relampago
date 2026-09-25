-- Stock del comercio en el almacén de Relámpago (fulfillment):
--   * Al pedir, el comercio elige productos de su stock. Las unidades quedan COMPROMETIDAS mientras
--     el pedido está pendiente / recogido / en ruta (no se puede pedir más de lo disponible).
--   * El stock se DESCUENTA cuando el pedido se entrega. Si una entrega se revierte, vuelve.
--     Anulado o no entregado: no se descuenta y lo comprometido se libera solo.
--   * Cada cambio de cantidad queda en stock_movements (ingreso, ajuste, entrega, corrección).
--   * Teléfono del destinatario: solo números.

alter table public.order_items add column if not exists stock_id uuid references public.stock(id) on delete set null;
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_stock_idx on public.order_items (stock_id);

-- Unidades comprometidas en pedidos que aún no se entregan
create or replace function public.stock_reserved(p_stock uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(i.quantity), 0)::int
  from public.order_items i join public.orders o on o.id = i.order_id
  where i.stock_id = p_stock and o.status in ('pending', 'picked_up', 'in_transit');
$$;
revoke all on function public.stock_reserved(uuid) from public;
grant execute on function public.stock_reserved(uuid) to authenticated;

-- Stock con lo comprometido y lo disponible (respeta los permisos de la tabla stock)
create or replace view public.stock_availability with (security_invoker = true) as
  select s.id, s.company_id, s.product_name, s.unit, s.quantity,
         public.stock_reserved(s.id) as reserved,
         s.quantity - public.stock_reserved(s.id) as available,
         s.created_at
  from public.stock s;
grant select on public.stock_availability to authenticated;

-- ---------------------------------------------------------------------------
-- Movimientos
-- ---------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  stock_id        uuid not null references public.stock(id) on delete cascade,
  company_id      uuid references public.companies(id) on delete cascade,
  delta           integer not null,
  quantity_after  integer not null,
  reason          text not null,                 -- ingreso | ajuste | entrega | correccion | saldo inicial
  order_id        uuid references public.orders(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists stock_movements_stock_idx on public.stock_movements (stock_id, created_at desc);
create index if not exists stock_movements_company_idx on public.stock_movements (company_id, created_at desc);
alter table public.stock_movements enable row level security;
drop policy if exists "staff_read_stock_movements" on public.stock_movements;
create policy "staff_read_stock_movements" on public.stock_movements for select to authenticated using (public.is_staff());
drop policy if exists "client_read_own_stock_movements" on public.stock_movements;
create policy "client_read_own_stock_movements" on public.stock_movements
  for select to authenticated using (company_id = public.my_company_id());

-- Todo cambio de cantidad se registra; el motivo lo pone quien descuenta (entrega) o es un ajuste manual
create or replace function public.log_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(current_setting('relampago.stock_reason', true), '');
  v_order  uuid := nullif(current_setting('relampago.stock_order', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    if new.quantity <> 0 then
      insert into public.stock_movements (stock_id, company_id, delta, quantity_after, reason, created_by)
      values (new.id, new.company_id, new.quantity, new.quantity, 'ingreso', auth.uid());
    end if;
  elsif new.quantity is distinct from old.quantity then
    insert into public.stock_movements (stock_id, company_id, delta, quantity_after, reason, order_id, created_by)
    values (new.id, new.company_id, new.quantity - old.quantity, new.quantity, coalesce(v_reason, 'ajuste'), v_order, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists stock_log_movement on public.stock;
create trigger stock_log_movement after insert or update of quantity on public.stock
  for each row execute function public.log_stock_movement();

-- Saldo inicial de lo que ya existe (una sola vez)
insert into public.stock_movements (stock_id, company_id, delta, quantity_after, reason)
select s.id, s.company_id, s.quantity, s.quantity, 'saldo inicial'
from public.stock s
where s.quantity <> 0 and not exists (select 1 from public.stock_movements m where m.stock_id = s.id);

-- ---------------------------------------------------------------------------
-- Descuento al entregar (y devolución si la entrega se revierte)
-- ---------------------------------------------------------------------------
create or replace function public.apply_stock_on_delivery()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it   record;
  sgn  int;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then sgn := -1;
  elsif old.status = 'delivered' and new.status is distinct from 'delivered' then sgn := 1;
  else return new;
  end if;
  perform set_config('relampago.stock_reason', case when sgn < 0 then 'entrega' else 'correccion' end, true);
  perform set_config('relampago.stock_order', new.id::text, true);
  for it in select stock_id, sum(quantity)::int as q from public.order_items where order_id = new.id and stock_id is not null group by stock_id loop
    -- nunca bloquea la entrega: si el stock quedó mal cargado puede quedar negativo y se ve en Inventario
    update public.stock set quantity = quantity + sgn * it.q where id = it.stock_id;
  end loop;
  perform set_config('relampago.stock_reason', '', true);
  perform set_config('relampago.stock_order', '', true);
  return new;
end;
$$;
drop trigger if exists orders_stock_on_delivery on public.orders;
create trigger orders_stock_on_delivery after update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function public.apply_stock_on_delivery();

-- ---------------------------------------------------------------------------
-- submit_order: productos del stock (validados contra lo disponible) + teléfono solo números
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_order(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company     public.companies%rowtype;
  v_own         boolean := false;
  v_addr        public.company_addresses%rowtype;
  v_token       text := nullif(btrim(p->>'intake_token'), '');
  v_name        text := btrim(p->>'sender_name');
  v_origin      text := coalesce(nullif(p->>'origin_type', ''), 'warehouse');
  v_pk          jsonb := coalesce(p->'pickup', '{}'::jsonb);
  v_addr_text   text;
  v_addr_norm   text;
  v_pickup_id   uuid;
  v_today       date := (now() at time zone 'America/Lima')::date;
  v_packages    int := greatest(1, coalesce(nullif(p->>'packages_count', '')::int, 1));
  v_amount      numeric := coalesce(nullif(p->>'amount_to_collect', '')::numeric, 0);
  v_order_id    uuid;
  v_order_no    bigint;
  v_lat         double precision := nullif(p->>'destination_lat', '')::double precision;
  v_lng         double precision := nullif(p->>'destination_lng', '')::double precision;
  v_tariff      text := coalesce(nullif(p->>'tariff', ''), public.tariff_from_district(p->>'destination_district'));
  v_sched       date;
  v_pk_lat      double precision := case when (v_pk->>'lat') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_pk->>'lat')::double precision end;
  v_pk_lng      double precision := case when (v_pk->>'lng') ~ '^-?[0-9]+([.][0-9]+)?$' then (v_pk->>'lng')::double precision end;
  v_base        numeric;
  v_fee         numeric;
  v_phone       text := regexp_replace(coalesce(p->>'recipient_phone', ''), '[^0-9]', '', 'g');
  v_it          record;
  v_stock       public.stock%rowtype;
  v_avail       integer;
  v_items       jsonb := '[]'::jsonb;
  v_items_text  text;
  v_details     text;
begin
  -- Validaciones mínimas del pedido
  if length(coalesce(btrim(p->>'recipient_name'), '')) < 2 then raise exception 'Nombre del destinatario requerido'; end if;
  if length(v_phone) < 6 or length(v_phone) > 15 then raise exception 'Teléfono del destinatario: solo números (6 a 15 dígitos)'; end if;
  if length(coalesce(btrim(p->>'destination_address'), '')) < 5 then raise exception 'Dirección del destinatario requerida'; end if;
  if not exists (select 1 from public.districts where name = public.canonical_district(p->>'destination_district')) then
    raise exception 'Elige el distrito del destinatario de la lista';
  end if;
  if v_amount < 0 or v_amount > 20000 then raise exception 'Monto a cobrar fuera de rango'; end if;

  -- Comercio con cuenta (portal): el pedido es siempre de su propia empresa
  if auth.uid() is not null then
    select c.* into v_company
    from public.companies c
    join public.profiles pr on pr.company_id = c.id
    where pr.id = auth.uid() and pr.role = 'client';
    v_own := found;
  end if;

  -- Formulario público cerrado: solo comercios con sesión (o la central)
  if not v_own and not public.is_staff() and not public.public_form_open() then
    raise exception 'Los pedidos ahora se registran desde tu cuenta en el portal de Relámpago Courier. Si aún no tienes acceso, pídelo a Relámpago.';
  end if;

  -- Empresa: por link propio o por nombre (se crea si no existe)
  if v_own then
    null;
  elsif v_token is not null then
    select * into v_company from public.companies where intake_token = v_token;
    if not found then raise exception 'Link de pedidos inválido'; end if;
  else
    if v_name is null or length(v_name) < 2 then raise exception 'Nombre del negocio requerido'; end if;
    select * into v_company from public.companies where lower(name) = lower(v_name) order by created_at limit 1;
    if not found then
      insert into public.companies (name, email) values (v_name, nullif(btrim(p->>'sender_email'), ''))
      returning * into v_company;
    end if;
  end if;

  -- Día de atención según el horario de corte (los comercios prioritarios entran para hoy)
  v_sched := public.schedule_date_for(v_origin, v_company.skip_cutoff);

  -- Tarifa por zona (viene del mapa de cobertura en el cliente); el monto aplica las condiciones de la empresa
  if v_tariff is not null then
    v_base := case v_tariff when 'T1' then 10 when 'T2' then 13 when 'T3' then 16 when 'T4' then 19 when 'T5' then 22 else null end;
    if v_base is null then v_tariff := null;
    else
      if v_tariff = 'T1' and v_company.t1_rate is not null then v_base := v_company.t1_rate; end if;
      v_fee := round((case when v_company.invoice_igv then v_base * 1.18 else v_base end)::numeric, 2);
    end if;
  end if;

  -- Recojo (si el paquete no sale del almacén)
  if v_origin = 'pickup' then
    if nullif(v_pk->>'address_id', '') is not null then
      select * into v_addr from public.company_addresses
      where id = (v_pk->>'address_id')::uuid and company_id = v_company.id;
      if not found then raise exception 'Dirección de recojo inválida'; end if;
      v_addr_text := v_addr.address;
    else
      -- Las direcciones del comercio con cuenta las registra Relámpago
      if v_own then
        raise exception 'Elige una de tus direcciones de recojo registradas. Para agregar otra, pídela a Relámpago Courier.';
      end if;
      v_addr_text := btrim(v_pk->>'address');
      if v_addr_text is null or length(v_addr_text) < 5 then raise exception 'Dirección de recojo requerida'; end if;
    end if;
    v_addr_norm := lower(regexp_replace(v_addr_text, '\s+', ' ', 'g'));

    -- Dirección escrita a mano: queda guardada en la empresa para la próxima vez
    if v_addr.id is null then
      select * into v_addr from public.company_addresses
      where company_id = v_company.id and lower(regexp_replace(address, '\s+', ' ', 'g')) = v_addr_norm
      limit 1;
      if not found then
        insert into public.company_addresses (company_id, address, district, contact_name, contact_phone, notes, is_default, lat, lng)
        values (
          v_company.id, v_addr_text,
          (select name from public.districts where name = public.canonical_district(v_pk->>'district')),
          nullif(v_pk->>'contact_name', ''), nullif(v_pk->>'contact_phone', ''), nullif(btrim(v_pk->>'notes'), ''),
          not exists (select 1 from public.company_addresses where company_id = v_company.id),
          case when v_pk_lat between -90 and 90 and v_pk_lng between -180 and 180 then v_pk_lat end,
          case when v_pk_lat between -90 and 90 and v_pk_lng between -180 and 180 then v_pk_lng end
        ) returning * into v_addr;
      elsif v_addr.lat is null and v_pk_lat between -90 and 90 and v_pk_lng between -180 and 180 then
        -- La dirección ya existía sin punto: se le guarda el que marcó el comercio
        update public.company_addresses set lat = v_pk_lat, lng = v_pk_lng where id = v_addr.id returning * into v_addr;
      end if;
    end if;

    -- Mismo negocio, misma dirección, mismo día y aún no recogido -> se agrupa
    select id into v_pickup_id from public.pickups
    where company_id = v_company.id and scheduled_date = v_sched and status in ('pending', 'assigned')
      and lower(regexp_replace(address, '\s+', ' ', 'g')) = v_addr_norm
    order by created_at limit 1;

    if v_pickup_id is null then
      insert into public.pickups (
        company_id, company_address_id, address, district, lat, lng,
        contact_name, contact_phone, pickup_after, pickup_before, notes, packages_count, scheduled_date
      ) values (
        v_company.id, v_addr.id, v_addr_text, coalesce(v_addr.district, nullif(v_pk->>'district', '')), v_addr.lat, v_addr.lng,
        coalesce(nullif(v_pk->>'contact_name', ''), v_addr.contact_name),
        coalesce(nullif(v_pk->>'contact_phone', ''), v_addr.contact_phone),
        nullif(v_pk->>'after', '')::time, nullif(v_pk->>'before', '')::time,
        nullif(btrim(v_pk->>'notes'), ''), v_packages, v_sched
      ) returning id into v_pickup_id;
    else
      update public.pickups
      set packages_count = coalesce(packages_count, 0) + v_packages,
          notes = nullif(concat_ws(E'\n', notes, nullif(btrim(v_pk->>'notes'), '')), ''),
          pickup_after = least(pickup_after, nullif(v_pk->>'after', '')::time),
          pickup_before = greatest(pickup_before, nullif(v_pk->>'before', '')::time),
          lat = coalesce(lat, v_addr.lat),
          lng = coalesce(lng, v_addr.lng)
      where id = v_pickup_id;
    end if;
  end if;

  -- Productos del stock del comercio (solo si salen del almacén): se validan contra lo disponible
  if v_origin = 'warehouse' and jsonb_typeof(p->'items') = 'array' and jsonb_array_length(p->'items') > 0 then
    for v_it in
      select (x->>'stock_id')::uuid as sid, sum((x->>'quantity')::int)::int as q
      from jsonb_array_elements(p->'items') x
      group by 1
    loop
      if v_it.q is null or v_it.q < 1 or v_it.q > 10000 then raise exception 'Cantidad de producto inválida'; end if;
      select * into v_stock from public.stock where id = v_it.sid and company_id = v_company.id for update;
      if not found then raise exception 'Ese producto no está en tu stock'; end if;
      v_avail := v_stock.quantity - public.stock_reserved(v_stock.id);
      if v_it.q > v_avail then
        raise exception 'Stock insuficiente de "%": disponible %', v_stock.product_name, greatest(v_avail, 0);
      end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object('stock_id', v_stock.id, 'product_name', v_stock.product_name, 'quantity', v_it.q));
      v_items_text := concat_ws(', ', v_items_text, v_it.q || ' × ' || v_stock.product_name);
    end loop;
  end if;
  v_details := nullif(concat_ws(' · ', v_items_text, nullif(btrim(p->>'product_details'), '')), '');

  insert into public.orders (
    company_id, sender_name, sender_email, recipient_name, recipient_phone,
    destination_district, destination_address, product_details, packages_count, amount_to_collect,
    comments, status, origin_type, pickup_id, service_type, deliver_after, deliver_before, call_before,
    recipient_payment, agency_name, agency_destination, recipient_dni,
    destination_lat, destination_lng, tariff, tariff_zone, total_amount, created_by, scheduled_date, destination_approx
  ) values (
    v_company.id, v_company.name, nullif(btrim(p->>'sender_email'), ''),
    btrim(p->>'recipient_name'), v_phone,
    nullif(p->>'destination_district', ''), btrim(p->>'destination_address'),
    v_details, v_packages, v_amount,
    nullif(btrim(p->>'comments'), ''), 'pending',
    v_origin::public.origin_type, v_pickup_id,
    coalesce(nullif(p->>'service_type', ''), 'delivery')::public.service_type,
    nullif(p->>'deliver_after', '')::time, nullif(p->>'deliver_before', '')::time,
    coalesce((p->>'call_before')::boolean, false),
    case when v_amount > 0 then coalesce(nullif(p->>'recipient_payment', ''), 'none')::public.payment_form else 'none' end,
    nullif(btrim(p->>'agency_name'), ''), nullif(btrim(p->>'agency_destination'), ''), nullif(btrim(p->>'recipient_dni'), ''),
    case when v_lat between -90 and 90 and v_lng between -180 and 180 then v_lat end,
    case when v_lat between -90 and 90 and v_lng between -180 and 180 then v_lng end,
    v_tariff, nullif(btrim(p->>'tariff_zone'), ''), v_fee, auth.uid(), v_sched,
    coalesce((p->>'destination_approx')::boolean, false) and v_lat is not null
  ) returning id, order_number into v_order_id, v_order_no;

  if jsonb_array_length(v_items) > 0 then
    insert into public.order_items (order_id, stock_id, product_name, quantity)
    select v_order_id, (x->>'stock_id')::uuid, x->>'product_name', (x->>'quantity')::int from jsonb_array_elements(v_items) x;
  end if;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_no, 'pickup_id', v_pickup_id, 'scheduled_date', v_sched, 'tariff', v_tariff);
end;
$function$;

revoke all on function public.submit_order(jsonb) from public;
grant execute on function public.submit_order(jsonb) to anon, authenticated;
