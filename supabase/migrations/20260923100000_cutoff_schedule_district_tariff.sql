-- Horarios de corte, fecha programada y tarifa por distrito (feedback del dueño, 2026-09-23).
--   * Corte: recojos hasta las 8:00, envíos desde almacén hasta las 11:59 (hora de Lima). Después,
--     el pedido entra para el siguiente día hábil (lunes a sábado). Los comercios prioritarios
--     (companies.skip_cutoff) siempre entran para el mismo día.
--   * orders.scheduled_date: el día en que se atiende el pedido (los recojos ya tenían scheduled_date).
--   * El formulario ya no pide el punto en el mapa: la tarifa sale del distrito cuando este tiene
--     un solo precio; si tiene rango, queda por confirmar y la central la fija.
--   * orders.destination_approx: la ubicación se calculó a partir de la dirección (aproximada).

alter table public.companies add column if not exists skip_cutoff boolean not null default false;
comment on column public.companies.skip_cutoff is 'Comercio prioritario: sus pedidos entran para el mismo día aunque pase el horario de corte';

alter table public.orders add column if not exists destination_approx boolean not null default false;
comment on column public.orders.destination_approx is 'true = coordenadas aproximadas (geocodificadas desde la dirección), no un pin exacto';

-- ---------------------------------------------------------------------------
-- orders.scheduled_date (se rellena sin disparar el trigger que toca updated_at)
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists scheduled_date date;
alter table public.orders disable trigger orders_set_delivered_at;
update public.orders o set scheduled_date = coalesce(
  (select p.scheduled_date from public.pickups p where p.id = o.pickup_id),
  (o.created_at at time zone 'America/Lima')::date
) where o.scheduled_date is null;
alter table public.orders enable trigger orders_set_delivered_at;
alter table public.orders
  alter column scheduled_date set default ((now() at time zone 'America/Lima')::date),
  alter column scheduled_date set not null;
create index if not exists orders_scheduled_date_idx on public.orders (scheduled_date);

-- ---------------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------------
-- Siguiente día hábil (se trabaja de lunes a sábado)
create or replace function public.next_business_day(d date)
returns date language sql immutable as $$
  select case when extract(dow from d + 1) = 0 then d + 2 else d + 1 end;
$$;

-- Día en que se atiende un pedido registrado en p_at, según su origen y el horario de corte
create or replace function public.schedule_date_for(p_origin text, p_skip_cutoff boolean, p_at timestamptz default now())
returns date language sql stable as $$
  with t as (select (p_at at time zone 'America/Lima') as l)
  select case
    when extract(dow from l::date) = 0 then l::date + 1                     -- domingo: pasa al lunes
    when coalesce(p_skip_cutoff, false) then l::date                          -- comercio prioritario
    when l::time < (case when p_origin = 'pickup' then time '08:01' else time '12:00' end) then l::date
    else public.next_business_day(l::date)
  end
  from t;
$$;

-- Tarifa a partir del distrito elegido ("San Luis (s/10.00)" -> T1). Si el distrito tiene
-- rango de precios ("Comas (De s/10.00 - s/13.00)") devuelve null: la central la confirma.
create or replace function public.tariff_from_district(p_district text)
returns text language sql immutable as $$
  with a as (
    select distinct (m[1])::numeric as amount
    from regexp_matches(coalesce(p_district, ''), 's/\s*(\d+(?:\.\d+)?)', 'gi') as m
  )
  select case when (select count(*) from a) = 1 then
    case (select amount from a) when 10 then 'T1' when 13 then 'T2' when 16 then 'T3' when 19 then 'T4' when 22 then 'T5' end
  end;
$$;

-- Si la central mueve un recojo de día, sus pedidos pendientes se mueven con él
create or replace function public.sync_pickup_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.orders set scheduled_date = new.scheduled_date
  where pickup_id = new.id and status = 'pending' and scheduled_date is distinct from new.scheduled_date;
  return new;
end;
$$;
drop trigger if exists pickups_sync_schedule on public.pickups;
create trigger pickups_sync_schedule
  after update of scheduled_date on public.pickups
  for each row when (old.scheduled_date is distinct from new.scheduled_date)
  execute function public.sync_pickup_schedule();

-- El link propio de la empresa también dice si es prioritaria (para mostrar "entra para hoy")
create or replace function public.intake_context(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'skip_cutoff', c.skip_cutoff),
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'label', a.label, 'address', a.address, 'district', a.district,
        'contact_name', a.contact_name, 'contact_phone', a.contact_phone
      ) order by a.is_default desc, a.created_at)
      from public.company_addresses a where a.company_id = c.id
    ), '[]'::jsonb)
  )
  from public.companies c where c.intake_token = p_token;
$$;

-- ---------------------------------------------------------------------------
-- submit_order: fecha programada, tarifa por distrito, coordenadas aproximadas
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
  v_base        numeric;
  v_fee         numeric;
begin
  -- Validaciones mínimas del pedido
  if length(coalesce(btrim(p->>'recipient_name'), '')) < 2 then raise exception 'Nombre del destinatario requerido'; end if;
  if length(coalesce(btrim(p->>'recipient_phone'), '')) < 6 then raise exception 'Teléfono del destinatario requerido'; end if;
  if length(coalesce(btrim(p->>'destination_address'), '')) < 5 then raise exception 'Dirección del destinatario requerida'; end if;
  if length(coalesce(btrim(p->>'destination_district'), '')) < 2 then raise exception 'Distrito del destinatario requerido'; end if;
  if v_amount < 0 or v_amount > 20000 then raise exception 'Monto a cobrar fuera de rango'; end if;

  -- Comercio con cuenta (portal): el pedido es siempre de su propia empresa
  if auth.uid() is not null then
    select c.* into v_company
    from public.companies c
    join public.profiles pr on pr.company_id = c.id
    where pr.id = auth.uid() and pr.role = 'client';
    v_own := found;
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
        insert into public.company_addresses (company_id, address, district, contact_name, contact_phone, notes, is_default)
        values (
          v_company.id, v_addr_text, nullif(v_pk->>'district', ''),
          nullif(v_pk->>'contact_name', ''), nullif(v_pk->>'contact_phone', ''), nullif(btrim(v_pk->>'notes'), ''),
          not exists (select 1 from public.company_addresses where company_id = v_company.id)
        ) returning * into v_addr;
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
          pickup_before = greatest(pickup_before, nullif(v_pk->>'before', '')::time)
      where id = v_pickup_id;
    end if;
  end if;

  insert into public.orders (
    company_id, sender_name, sender_email, recipient_name, recipient_phone,
    destination_district, destination_address, product_details, packages_count, amount_to_collect,
    comments, status, origin_type, pickup_id, service_type, deliver_after, deliver_before, call_before,
    recipient_payment, agency_name, agency_destination, recipient_dni,
    destination_lat, destination_lng, tariff, tariff_zone, total_amount, created_by, scheduled_date, destination_approx
  ) values (
    v_company.id, v_company.name, nullif(btrim(p->>'sender_email'), ''),
    btrim(p->>'recipient_name'), btrim(p->>'recipient_phone'),
    nullif(p->>'destination_district', ''), btrim(p->>'destination_address'),
    nullif(btrim(p->>'product_details'), ''), v_packages, v_amount,
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

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_no, 'pickup_id', v_pickup_id, 'scheduled_date', v_sched, 'tariff', v_tariff);
end;
$function$;

revoke all on function public.submit_order(jsonb) from public;
grant execute on function public.submit_order(jsonb) to anon, authenticated;
