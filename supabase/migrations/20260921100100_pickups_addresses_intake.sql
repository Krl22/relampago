-- Modelo operativo real de Relámpago:
--   * las empresas tienen varias direcciones (company_addresses) y un link propio de pedidos (intake_token)
--   * ~la mitad de los paquetes NO sale del almacén: hay recojos (pickups) en una dirección,
--     que agrupan varios pedidos y pueden atenderlos varios motorizados (pickup_assignments)
--   * los pedidos llevan tipo de servicio, ventana horaria, forma de cobro y datos de agencia
--   * el formulario público inserta a través de submit_order() (security definer), así que
--     anon deja de tener acceso directo a companies/orders.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.origin_type as enum ('warehouse', 'pickup');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.service_type as enum ('delivery', 'exchange', 'return', 'agency');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_form as enum ('none', 'cash', 'yape', 'plin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pickup_status as enum ('pending', 'assigned', 'picked_up', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- companies: correo, contacto y link propio de pedidos
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists email text,
  add column if not exists contact_name text,
  add column if not exists intake_token text;

update public.companies
  set intake_token = translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_')
  where intake_token is null;

alter table public.companies
  alter column intake_token set default translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_'),
  alter column intake_token set not null;

create unique index if not exists companies_intake_token_key on public.companies (intake_token);
create index if not exists companies_lower_name_idx on public.companies (lower(name));

-- ---------------------------------------------------------------------------
-- company_addresses
-- ---------------------------------------------------------------------------
create table if not exists public.company_addresses (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  label         text,                       -- "Tienda Larco", "Almacén", ...
  address       text not null,
  district      text,
  lat           double precision,
  lng           double precision,
  contact_name  text,
  contact_phone text,
  notes         text,                       -- horario de atención, referencias
  is_default    boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists company_addresses_company_idx on public.company_addresses (company_id);

-- La dirección que ya tenían las empresas pasa a ser su dirección principal
insert into public.company_addresses (company_id, label, address, district, is_default)
select c.id, 'Principal', c.address, c.district, true
from public.companies c
where c.address is not null and btrim(c.address) <> ''
  and not exists (select 1 from public.company_addresses a where a.company_id = c.id);

alter table public.company_addresses enable row level security;

drop policy if exists "staff_manage_company_addresses" on public.company_addresses;
create policy "staff_manage_company_addresses" on public.company_addresses
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "client_read_own_company_addresses" on public.company_addresses;
create policy "client_read_own_company_addresses" on public.company_addresses
  for select to authenticated
  using (company_id = (select company_id from public.profiles where id = auth.uid()));

-- ---------------------------------------------------------------------------
-- pickups + pickup_assignments
-- ---------------------------------------------------------------------------
create table if not exists public.pickups (
  id                  uuid primary key default gen_random_uuid(),
  pickup_number       bigint generated always as identity,
  company_id          uuid references public.companies(id) on delete set null,
  company_address_id  uuid references public.company_addresses(id) on delete set null,
  address             text not null,
  district            text,
  lat                 double precision,
  lng                 double precision,
  contact_name        text,
  contact_phone       text,
  scheduled_date      date not null default (now() at time zone 'America/Lima')::date,
  pickup_after        time,
  pickup_before       time,
  packages_count      integer,
  notes               text,
  status              public.pickup_status not null default 'pending',
  legacy_courier_name text,                 -- importación del histórico (motorizados sin usuario)
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists pickups_date_status_idx on public.pickups (scheduled_date desc, status);
create index if not exists pickups_company_idx on public.pickups (company_id);

create table if not exists public.pickup_assignments (
  pickup_id    uuid not null references public.pickups(id) on delete cascade,
  courier_id   uuid not null references public.profiles(id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  picked_up_at timestamptz,
  packages_count integer,                   -- cuántos se llevó este motorizado (opcional)
  primary key (pickup_id, courier_id)
);
create index if not exists pickup_assignments_courier_idx on public.pickup_assignments (courier_id);

alter table public.pickups enable row level security;
alter table public.pickup_assignments enable row level security;

drop policy if exists "staff_manage_pickups" on public.pickups;
create policy "staff_manage_pickups" on public.pickups
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "courier_read_assigned_pickups" on public.pickups;
create policy "courier_read_assigned_pickups" on public.pickups
  for select to authenticated
  using (exists (select 1 from public.pickup_assignments a where a.pickup_id = pickups.id and a.courier_id = auth.uid()));

drop policy if exists "staff_manage_pickup_assignments" on public.pickup_assignments;
create policy "staff_manage_pickup_assignments" on public.pickup_assignments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "courier_read_own_assignments" on public.pickup_assignments;
create policy "courier_read_own_assignments" on public.pickup_assignments
  for select to authenticated using (courier_id = auth.uid());

drop policy if exists "courier_update_own_assignments" on public.pickup_assignments;
create policy "courier_update_own_assignments" on public.pickup_assignments
  for update to authenticated using (courier_id = auth.uid()) with check (courier_id = auth.uid());

-- updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists pickups_set_updated_at on public.pickups;
create trigger pickups_set_updated_at before update on public.pickups
  for each row execute procedure public.set_updated_at();

-- El estado del recojo se deriva de sus asignaciones:
--   sin asignaciones -> pending · alguna sin recoger -> assigned · todas recogidas -> picked_up
create or replace function public.sync_pickup_status()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pickup_id uuid := coalesce(new.pickup_id, old.pickup_id);
  v_total int; v_done int; v_status public.pickup_status;
begin
  select count(*), count(picked_up_at) into v_total, v_done
  from public.pickup_assignments where pickup_id = v_pickup_id;

  select status into v_status from public.pickups where id = v_pickup_id;
  if v_status in ('failed', 'cancelled') then return null; end if;

  update public.pickups
  set status = case
        when v_total = 0 then 'pending'::public.pickup_status
        when v_done = v_total then 'picked_up'::public.pickup_status
        else 'assigned'::public.pickup_status
      end
  where id = v_pickup_id;
  return null;
end;
$$;
drop trigger if exists pickup_assignments_sync_status on public.pickup_assignments;
create trigger pickup_assignments_sync_status
  after insert or update or delete on public.pickup_assignments
  for each row execute procedure public.sync_pickup_status();

-- Cuando el recojo se completa, sus pedidos pendientes pasan a "recogido"
create or replace function public.pickup_completed_orders()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'picked_up' and old.status is distinct from new.status then
    update public.orders set status = 'picked_up'
    where pickup_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;
drop trigger if exists pickups_completed_orders on public.pickups;
create trigger pickups_completed_orders
  after update of status on public.pickups
  for each row execute procedure public.pickup_completed_orders();

-- ---------------------------------------------------------------------------
-- orders: número legible, origen, servicio, horario, cobro, agencia
-- ---------------------------------------------------------------------------
-- FIX: el trigger set_order_delivered_at (migración 20260920180100) asigna new.updated_at,
-- pero la columna no existía y rompía todo UPDATE sobre orders.
alter table public.orders add column if not exists updated_at timestamptz not null default now();

create sequence if not exists public.orders_order_number_seq;
alter table public.orders add column if not exists order_number bigint;
update public.orders o
set order_number = s.rn
from (select id, row_number() over (order by created_at nulls last, id) as rn from public.orders) s
where s.id = o.id and o.order_number is null;
select setval('public.orders_order_number_seq', coalesce((select max(order_number) from public.orders), 0) + 1, false);
alter table public.orders
  alter column order_number set default nextval('public.orders_order_number_seq'),
  alter column order_number set not null;
alter sequence public.orders_order_number_seq owned by public.orders.order_number;
create unique index if not exists orders_order_number_key on public.orders (order_number);

alter table public.orders
  add column if not exists origin_type        public.origin_type not null default 'warehouse',
  add column if not exists pickup_id          uuid references public.pickups(id) on delete set null,
  add column if not exists service_type       public.service_type not null default 'delivery',
  add column if not exists deliver_after      time,
  add column if not exists deliver_before     time,
  add column if not exists call_before        boolean not null default false,
  add column if not exists recipient_payment  public.payment_form not null default 'none',
  add column if not exists agency_name        text,
  add column if not exists agency_destination text,
  add column if not exists recipient_dni      text,
  add column if not exists sender_email       text;

create index if not exists orders_pickup_idx on public.orders (pickup_id);
create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists orders_company_created_idx on public.orders (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: anon ya no toca tablas directamente; clientes solo ven lo suyo
-- ---------------------------------------------------------------------------
drop policy if exists "Enable insert for all users" on public.companies;
drop policy if exists "Enable read access for all users" on public.companies;
drop policy if exists "staff_manage_companies" on public.companies;
create policy "staff_manage_companies" on public.companies
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "authenticated_read_companies" on public.companies;
create policy "authenticated_read_companies" on public.companies
  for select to authenticated using (true);

drop policy if exists "Enable insert for everyone" on public.orders;
drop policy if exists "Enable read access for authenticated users" on public.orders;
drop policy if exists "staff_insert_orders" on public.orders;
create policy "staff_insert_orders" on public.orders
  for insert to authenticated with check (public.is_staff());
drop policy if exists "read_orders_by_role" on public.orders;
create policy "read_orders_by_role" on public.orders
  for select to authenticated
  using (
    public.is_staff()
    or assigned_courier = auth.uid()
    or company_id = (select company_id from public.profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Funciones para el formulario público (anon)
-- ---------------------------------------------------------------------------

-- Autocompletado del nombre del negocio: solo nombres, mínimo 3 letras.
create or replace function public.search_company_names(p_q text)
returns setof text
language sql stable security definer set search_path = public as $$
  select name from public.companies
  where length(btrim(p_q)) >= 3 and name ilike '%' || btrim(p_q) || '%'
  order by name limit 8;
$$;
revoke all on function public.search_company_names(text) from public;
grant execute on function public.search_company_names(text) to anon, authenticated;

-- Contexto del link propio de una empresa: nombre + direcciones guardadas.
create or replace function public.intake_context(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name),
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
revoke all on function public.intake_context(text) from public;
grant execute on function public.intake_context(text) to anon, authenticated;

-- Alta de pedido desde el formulario público. Resuelve la empresa (por token o nombre),
-- crea o reutiliza el recojo del día en esa dirección, e inserta el pedido; todo en una transacción.
create or replace function public.submit_order(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company     public.companies%rowtype;
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
begin
  -- Validaciones mínimas del pedido
  if length(coalesce(btrim(p->>'recipient_name'), '')) < 2 then raise exception 'Nombre del destinatario requerido'; end if;
  if length(coalesce(btrim(p->>'recipient_phone'), '')) < 6 then raise exception 'Teléfono del destinatario requerido'; end if;
  if length(coalesce(btrim(p->>'destination_address'), '')) < 5 then raise exception 'Dirección del destinatario requerida'; end if;
  if length(coalesce(btrim(p->>'destination_district'), '')) < 2 then raise exception 'Distrito del destinatario requerido'; end if;
  if v_amount < 0 or v_amount > 20000 then raise exception 'Monto a cobrar fuera de rango'; end if;

  -- Empresa: por link propio o por nombre (se crea si no existe)
  if v_token is not null then
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

    -- Mismo negocio, misma dirección, mismo día y aún no recogido -> se agrupa
    select id into v_pickup_id from public.pickups
    where company_id = v_company.id and scheduled_date = v_today and status in ('pending', 'assigned')
      and lower(regexp_replace(address, '\s+', ' ', 'g')) = v_addr_norm
    order by created_at limit 1;

    if v_pickup_id is null then
      insert into public.pickups (
        company_id, company_address_id, address, district, lat, lng,
        contact_name, contact_phone, pickup_after, pickup_before, notes, packages_count
      ) values (
        v_company.id, v_addr.id, v_addr_text, coalesce(v_addr.district, nullif(v_pk->>'district', '')), v_addr.lat, v_addr.lng,
        coalesce(nullif(v_pk->>'contact_name', ''), v_addr.contact_name),
        coalesce(nullif(v_pk->>'contact_phone', ''), v_addr.contact_phone),
        nullif(v_pk->>'after', '')::time, nullif(v_pk->>'before', '')::time,
        nullif(btrim(v_pk->>'notes'), ''), v_packages
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
    recipient_payment, agency_name, agency_destination, recipient_dni
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
    case when v_amount > 0 then coalesce(nullif(p->>'recipient_payment', ''), 'cash')::public.payment_form else 'none' end,
    nullif(btrim(p->>'agency_name'), ''), nullif(btrim(p->>'agency_destination'), ''), nullif(btrim(p->>'recipient_dni'), '')
  ) returning id, order_number into v_order_id, v_order_no;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_no, 'pickup_id', v_pickup_id);
end;
$$;
revoke all on function public.submit_order(jsonb) from public;
grant execute on function public.submit_order(jsonb) to anon, authenticated;

-- Realtime para recojos (panel admin)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pickups'
  ) then
    alter publication supabase_realtime add table public.pickups;
  end if;
end;
$$;
