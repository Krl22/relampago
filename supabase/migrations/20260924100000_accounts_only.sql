-- Todos los comercios piden con su cuenta (decisión de los dueños, 2026-09-24).
--   * Las cuentas las crea Relámpago (el alta de un comercio nuevo empieza con una llamada):
--     se quita el registro propio (register_my_company deja de estar disponible).
--   * El formulario público se cierra con un interruptor (app_settings.public_form_open) cuando
--     los comercios activos ya tengan su cuenta. Cerrado: submit_order solo acepta pedidos de
--     comercios con sesión (o de admin/staff) y las búsquedas públicas de nombres/direcciones se apagan.

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
alter table public.app_settings enable row level security;
drop policy if exists "staff_manage_app_settings" on public.app_settings;
create policy "staff_manage_app_settings" on public.app_settings
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.app_settings (key, value) values ('public_form_open', 'true'::jsonb) on conflict (key) do nothing;

create or replace function public.public_form_open()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'public_form_open'), true);
$$;
revoke all on function public.public_form_open() from public;
grant execute on function public.public_form_open() to anon, authenticated;

-- Sin registro propio
revoke execute on function public.register_my_company(jsonb) from authenticated;

-- Búsquedas del formulario público: solo mientras esté abierto
create or replace function public.search_company_names(p_q text)
returns setof text
language sql stable security definer set search_path = public as $$
  select name from public.companies
  where public.public_form_open() and length(btrim(p_q)) >= 3 and name ilike '%' || btrim(p_q) || '%'
  order by name limit 8;
$$;

create or replace function public.company_addresses_by_name(p_name text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'address', a.address, 'district', a.district)
                     order by a.is_default desc, a.created_at)
    from public.company_addresses a
    join public.companies c on c.id = a.company_id
    where public.public_form_open() and lower(c.name) = lower(btrim(p_name))
  ), '[]'::jsonb);
$$;

-- El portal usa el contexto de su propia empresa aunque el formulario público esté cerrado
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
  from public.companies c
  where c.intake_token = p_token
    and (public.public_form_open() or c.id = public.my_company_id() or public.is_staff());
$$;

-- ---------------------------------------------------------------------------
-- submit_order: con el formulario cerrado solo pide quien tiene cuenta
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
