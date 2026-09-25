-- Catálogo único de distritos (y agencias) con sus precios.
--   * Antes los pedidos guardaban "San Luis (s/10.00)" (con el precio pegado) y las direcciones
--     "San Luis"; además la importación dejó valores sueltos ("Surco2", "lois olivos"...).
--   * Ahora todas las tablas guardan el nombre del catálogo: pedidos, recojos, direcciones y comercios
--     tienen una llave foránea a public.districts, y un trigger convierte lo que llegue
--     ("San Luis (s/10.00)", "santiago de surco", "SJL") al nombre oficial. Un valor que no exista
--     en el catálogo se rechaza: ya no puede entrar data sucia por ningún camino.
--   * La tarifa por distrito sale del catálogo (antes se leía del texto del distrito).

create table if not exists public.districts (
  name        text primary key,
  prices      numeric[] not null,                 -- precios posibles del envío (S/); uno solo = tarifa fija
  kind        text not null default 'district' check (kind in ('district', 'agency')),
  aliases     text[] not null default '{}',       -- otras formas de escribirlo (minúsculas, sin tildes)
  sort_order  int not null default 0,
  active      boolean not null default true
);
alter table public.districts enable row level security;
drop policy if exists "read_districts" on public.districts;
create policy "read_districts" on public.districts for select to anon, authenticated using (true);
drop policy if exists "staff_manage_districts" on public.districts;
create policy "staff_manage_districts" on public.districts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.districts (name, prices, kind, aliases, sort_order) values
  ('Ate', '{10,13,16}', 'district', array['ate vitarte', 'vitarte'], 10),
  ('Barranco', '{10}', 'district', '{}', 20),
  ('Breña', '{10}', 'district', '{}', 30),
  ('Callao', '{10,13}', 'district', array['callao cercado', 'bellavista', 'la perla', 'la punta', 'carmen de la legua', 'carmen de la legua reynoso', 'carmen de la legua-reynoso'], 40),
  ('Carabayllo', '{13,16,19}', 'district', '{}', 50),
  ('Cercado', '{10,13}', 'district', array['cercado de lima', 'lima cercado', 'centro de lima', 'lima'], 60),
  ('Chorrillos', '{10}', 'district', '{}', 70),
  ('Comas', '{10,13}', 'district', '{}', 80),
  ('El Agustino', '{10}', 'district', '{}', 90),
  ('Independencia', '{10,13}', 'district', '{}', 100),
  ('Jesús María', '{10}', 'district', '{}', 110),
  ('La Molina', '{10,13}', 'district', '{}', 120),
  ('La Victoria', '{10,13}', 'district', '{}', 130),
  ('Lince', '{10}', 'district', '{}', 140),
  ('Los Olivos', '{10}', 'district', '{}', 150),
  ('Lurigancho', '{13,16}', 'district', array['chosica', 'lurigancho chosica', 'lurigancho-chosica'], 160),
  ('Lurín', '{13,16}', 'district', '{}', 170),
  ('Magdalena', '{10}', 'district', array['magdalena del mar'], 180),
  ('Miraflores', '{10}', 'district', '{}', 190),
  ('Pachacamac', '{13,16}', 'district', array['manchay'], 200),
  ('Pueblo Libre', '{10}', 'district', array['magdalena vieja'], 210),
  ('Puente Piedra', '{13,16,19}', 'district', '{}', 220),
  ('Rímac', '{10,13}', 'district', '{}', 230),
  ('San Borja', '{10}', 'district', '{}', 240),
  ('San Isidro', '{10}', 'district', '{}', 250),
  ('San Juan de Lurigancho', '{10,13,16}', 'district', array['sjl'], 260),
  ('San Juan de Miraflores', '{10,13}', 'district', array['sjm'], 270),
  ('San Luis', '{10}', 'district', '{}', 280),
  ('San Martín de Porres', '{10,13}', 'district', array['smp'], 290),
  ('San Miguel', '{10}', 'district', '{}', 300),
  ('Santa Anita', '{10}', 'district', '{}', 310),
  ('Surco', '{10}', 'district', array['santiago de surco'], 320),
  ('Surquillo', '{10}', 'district', '{}', 330),
  ('Ventanilla', '{13,16,19}', 'district', array['mi peru'], 340),
  ('Villa El Salvador', '{10,13}', 'district', array['ves'], 350),
  ('Villa María del Triunfo', '{10,13}', 'district', array['vmt'], 360),
  ('Agencia Shalom', '{10}', 'agency', array['shalom'], 370),
  ('Agencia Olva', '{10}', 'agency', array['olva', 'olva courier'], 380),
  ('Agencia Marvisur', '{10}', 'agency', array['marvisur'], 390),
  ('Agencia Urbano', '{10}', 'agency', array['urbano'], 400),
  ('Otras Agencias', '{10,13}', 'agency', '{}', 410)
on conflict (name) do update set prices = excluded.prices, kind = excluded.kind, aliases = excluded.aliases, sort_order = excluded.sort_order;

-- Clave de comparación: sin precio entre paréntesis, minúsculas, sin tildes, espacios simples
create or replace function public.district_key(p text)
returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(translate(lower(split_part(coalesce(p, ''), ' (', 1)), 'áéíóúüñ', 'aeiouun'), '\s+', ' ', 'g')), '');
$$;

-- Nombre oficial del catálogo para cualquier forma de escribir un distrito (o el texto tal cual si no existe)
create or replace function public.canonical_district(p text)
returns text language sql stable security definer set search_path = public as $$
  select case when public.district_key(p) is null then null else coalesce(
    (select d.name from public.districts d
      where public.district_key(d.name) = public.district_key(p) or public.district_key(p) = any(d.aliases)
      order by (public.district_key(d.name) = public.district_key(p)) desc
      limit 1),
    btrim(p)
  ) end;
$$;
grant execute on function public.canonical_district(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Limpieza de lo existente
-- ---------------------------------------------------------------------------
-- Valores sueltos de la importación
update public.company_addresses set district = case district
    when 'lois olivos' then 'Los Olivos' when 'losolivos' then 'Los Olivos'
    when 'puelo libre' then 'Pueblo Libre' when 'salamanca' then 'Ate'   -- Urb. Salamanca (las dos direcciones dicen Ate)
    else null end                                                          -- 'shalom', 'jeremi': no son distritos
  where district in ('lois olivos', 'losolivos', 'puelo libre', 'salamanca', 'shalom', 'jeremi');
update public.pickups set district = case district when 'Surco2' then 'Surco' when 'lois olivos' then 'Los Olivos' else null end
  where district in ('Surco2', 'lois olivos', 'jeremi');

-- Todo al nombre oficial (en pedidos sin tocar updated_at)
alter table public.orders disable trigger orders_set_delivered_at;
update public.orders set destination_district = public.canonical_district(destination_district)
  where destination_district is distinct from public.canonical_district(destination_district);
alter table public.orders enable trigger orders_set_delivered_at;
update public.pickups set district = public.canonical_district(district) where district is distinct from public.canonical_district(district);
update public.company_addresses set district = public.canonical_district(district) where district is distinct from public.canonical_district(district);
update public.companies set district = public.canonical_district(district) where district is distinct from public.canonical_district(district);

-- Red de seguridad: lo que aún no exista en el catálogo queda vacío (se avisa cuántos)
do $$
declare n int;
begin
  alter table public.orders disable trigger orders_set_delivered_at;
  update public.orders set destination_district = null
    where destination_district is not null and not exists (select 1 from public.districts where name = destination_district);
  get diagnostics n = row_count; if n > 0 then raise notice 'pedidos con distrito desconocido vaciados: %', n; end if;
  alter table public.orders enable trigger orders_set_delivered_at;
  update public.pickups set district = null where district is not null and not exists (select 1 from public.districts where name = district);
  get diagnostics n = row_count; if n > 0 then raise notice 'recojos con distrito desconocido vaciados: %', n; end if;
  update public.company_addresses set district = null where district is not null and not exists (select 1 from public.districts where name = district);
  get diagnostics n = row_count; if n > 0 then raise notice 'direcciones con distrito desconocido vaciadas: %', n; end if;
  update public.companies set district = null where district is not null and not exists (select 1 from public.districts where name = district);
  get diagnostics n = row_count; if n > 0 then raise notice 'comercios con distrito desconocido vaciados: %', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- De aquí en adelante: normalizar al entrar + llave foránea
-- ---------------------------------------------------------------------------
create or replace function public.normalize_destination_district()
returns trigger language plpgsql as $$
begin
  new.destination_district := public.canonical_district(new.destination_district);
  return new;
end;
$$;
create or replace function public.normalize_district()
returns trigger language plpgsql as $$
begin
  new.district := public.canonical_district(new.district);
  return new;
end;
$$;

drop trigger if exists orders_normalize_district on public.orders;
create trigger orders_normalize_district before insert or update of destination_district on public.orders
  for each row execute function public.normalize_destination_district();
drop trigger if exists pickups_normalize_district on public.pickups;
create trigger pickups_normalize_district before insert or update of district on public.pickups
  for each row execute function public.normalize_district();
drop trigger if exists company_addresses_normalize_district on public.company_addresses;
create trigger company_addresses_normalize_district before insert or update of district on public.company_addresses
  for each row execute function public.normalize_district();
drop trigger if exists companies_normalize_district on public.companies;
create trigger companies_normalize_district before insert or update of district on public.companies
  for each row execute function public.normalize_district();

alter table public.orders drop constraint if exists orders_destination_district_fkey;
alter table public.orders add constraint orders_destination_district_fkey
  foreign key (destination_district) references public.districts(name) on update cascade;
alter table public.pickups drop constraint if exists pickups_district_fkey;
alter table public.pickups add constraint pickups_district_fkey
  foreign key (district) references public.districts(name) on update cascade;
alter table public.company_addresses drop constraint if exists company_addresses_district_fkey;
alter table public.company_addresses add constraint company_addresses_district_fkey
  foreign key (district) references public.districts(name) on update cascade;
alter table public.companies drop constraint if exists companies_district_fkey;
alter table public.companies add constraint companies_district_fkey
  foreign key (district) references public.districts(name) on update cascade;
create index if not exists orders_destination_district_idx on public.orders (destination_district);

-- Tarifa fija del distrito (null si tiene varios precios: la central la confirma)
create or replace function public.tariff_from_district(p_district text)
returns text language sql stable security definer set search_path = public as $$
  select case when cardinality(d.prices) = 1 then
    case d.prices[1] when 10 then 'T1' when 13 then 'T2' when 16 then 'T3' when 19 then 'T4' when 22 then 'T5' end
  end
  from public.districts d where d.name = public.canonical_district(p_district);
$$;

-- ---------------------------------------------------------------------------
-- submit_order: distrito validado contra el catálogo; punto del recojo nuevo (lat/lng)
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
begin
  -- Validaciones mínimas del pedido
  if length(coalesce(btrim(p->>'recipient_name'), '')) < 2 then raise exception 'Nombre del destinatario requerido'; end if;
  if length(coalesce(btrim(p->>'recipient_phone'), '')) < 6 then raise exception 'Teléfono del destinatario requerido'; end if;
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
