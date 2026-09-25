-- Portal de comercios: cuentas de cliente vinculadas a su empresa.
--   * profiles.email (copia de auth.users) para que el admin vea y gestione accesos
--   * registro propio: register_my_company() crea la empresa y la enlaza a la cuenta
--   * el comercio edita sus datos de contacto / Yape, sus direcciones y cancela pedidos pendientes
--   * lectura de companies y profiles acotada por rol (antes cualquier usuario autenticado leía todo)
--   * submit_order: un comercio con cuenta siempre pide para su propia empresa (created_by = usuario)

-- ---------------------------------------------------------------------------
-- profiles.email + sincronización desde auth.users
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists email text;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;
create index if not exists profiles_email_idx on public.profiles (lower(email));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), nullif(btrim(new.raw_user_meta_data->>'name'), '')),
    'client',
    new.email
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute procedure public.handle_user_email_change();

-- Quién registró la empresa desde el portal (null = creada por Relámpago o por el formulario)
alter table public.companies add column if not exists registered_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Helpers (security definer: no dependen de las policies y evitan recursión)
-- ---------------------------------------------------------------------------
create or replace function public.my_company_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid();
$$;
revoke all on function public.my_company_id() from public;
grant execute on function public.my_company_id() to authenticated, anon;

-- ¿El motorizado actual tiene (o tuvo) pedidos o recojos de esta empresa?
create or replace function public.courier_serves_company(p_company uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders where company_id = p_company and assigned_courier = auth.uid())
      or exists (
        select 1 from public.pickups p
        join public.pickup_assignments a on a.pickup_id = p.id
        where p.company_id = p_company and a.courier_id = auth.uid()
      );
$$;
revoke all on function public.courier_serves_company(uuid) from public;
grant execute on function public.courier_serves_company(uuid) to authenticated;

-- ¿Este motorizado atiende pedidos de mi empresa? (el comercio ve el nombre de quien le reparte)
create or replace function public.courier_serves_my_company(p_courier uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders where assigned_courier = p_courier and company_id = public.my_company_id()
  );
$$;
revoke all on function public.courier_serves_my_company(uuid) from public;
grant execute on function public.courier_serves_my_company(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lectura acotada por rol
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated_read_companies" on public.companies;
drop policy if exists "read_companies_by_role" on public.companies;
create policy "read_companies_by_role" on public.companies
  for select to authenticated
  using (public.is_staff() or id = public.my_company_id() or public.courier_serves_company(id));

drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "read_profiles_by_role" on public.profiles;
create policy "read_profiles_by_role" on public.profiles
  for select to authenticated
  using (public.is_staff() or id = auth.uid() or public.courier_serves_my_company(id));

-- El comercio administra sus direcciones de recojo
drop policy if exists "client_read_own_company_addresses" on public.company_addresses;
drop policy if exists "client_manage_own_company_addresses" on public.company_addresses;
create policy "client_manage_own_company_addresses" on public.company_addresses
  for all to authenticated
  using (company_id = public.my_company_id())
  with check (company_id = public.my_company_id());

-- El comercio ve el estado de sus recojos
drop policy if exists "client_read_own_pickups" on public.pickups;
create policy "client_read_own_pickups" on public.pickups
  for select to authenticated
  using (company_id = public.my_company_id());

-- ---------------------------------------------------------------------------
-- RPCs del portal
-- ---------------------------------------------------------------------------

-- Registro propio: crea la empresa y la enlaza a la cuenta (solo cuentas 'client' sin empresa)
create or replace function public.register_my_company(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles%rowtype;
  v_name     text := btrim(p->>'name');
  v_ruc      text := nullif(regexp_replace(coalesce(p->>'ruc', ''), '\D', '', 'g'), '');
  v_contact  text := nullif(btrim(p->>'contact_name'), '');
  v_phone    text := nullif(btrim(p->>'phone'), '');
  v_district text := nullif(btrim(p->>'district'), '');
  v_address  text := nullif(btrim(p->>'address'), '');
  v_id       uuid;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if not found then raise exception 'Perfil no encontrado'; end if;
  if v_profile.role <> 'client' then raise exception 'Solo las cuentas de comercio pueden registrar un comercio'; end if;
  if v_profile.company_id is not null then raise exception 'Tu cuenta ya está vinculada a un comercio'; end if;
  if v_name is null or length(v_name) < 2 then raise exception 'El nombre del comercio es requerido'; end if;
  if v_contact is null then raise exception 'El nombre de contacto es requerido'; end if;
  if v_phone is null or length(v_phone) < 6 then raise exception 'El teléfono es requerido'; end if;
  if v_ruc is not null and length(v_ruc) <> 11 then raise exception 'El RUC debe tener 11 dígitos'; end if;
  if exists (select 1 from public.companies where lower(name) = lower(v_name)) then
    raise exception 'Ya existe un comercio llamado "%". Si es el tuyo, pide tu acceso a Relámpago Courier.', v_name;
  end if;
  if v_ruc is not null and exists (select 1 from public.companies where ruc = v_ruc) then
    raise exception 'Ese RUC ya está registrado. Si es tu comercio, pide tu acceso a Relámpago Courier.';
  end if;

  insert into public.companies (name, ruc, phone, email, contact_name, address, district, yape_number, yape_holder, registered_by)
  values (
    v_name, v_ruc, v_phone, coalesce(nullif(btrim(p->>'email'), ''), v_profile.email), v_contact, v_address, v_district,
    nullif(btrim(p->>'yape_number'), ''), nullif(btrim(p->>'yape_holder'), ''), v_uid
  ) returning id into v_id;

  if v_address is not null then
    insert into public.company_addresses (company_id, label, address, district, contact_name, contact_phone, is_default)
    values (v_id, 'Principal', v_address, v_district, v_contact, v_phone, true);
  end if;

  update public.profiles set company_id = v_id, full_name = coalesce(v_contact, full_name) where id = v_uid;
  return v_id;
end;
$$;
revoke all on function public.register_my_company(jsonb) from public;
grant execute on function public.register_my_company(jsonb) to authenticated;

-- El comercio actualiza solo sus datos de contacto y Yape (tarifas / IGV siguen siendo de Relámpago)
create or replace function public.update_my_company(p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid := public.my_company_id();
begin
  if v_cid is null then raise exception 'Tu cuenta no está vinculada a un comercio'; end if;
  update public.companies set
    contact_name = nullif(btrim(p->>'contact_name'), ''),
    phone        = nullif(btrim(p->>'phone'), ''),
    email        = nullif(btrim(p->>'email'), ''),
    yape_number  = nullif(btrim(p->>'yape_number'), ''),
    yape_holder  = nullif(btrim(p->>'yape_holder'), '')
  where id = v_cid;
  update public.profiles set full_name = coalesce(nullif(btrim(p->>'contact_name'), ''), full_name) where id = auth.uid();
end;
$$;
revoke all on function public.update_my_company(jsonb) from public;
grant execute on function public.update_my_company(jsonb) to authenticated;

-- El comercio cancela un pedido propio mientras siga pendiente
create or replace function public.cancel_my_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'cancelled'
  where id = p_order_id and company_id = public.my_company_id() and status = 'pending';
  if not found then
    raise exception 'Este pedido ya no se puede cancelar (ya está en proceso o no pertenece a tu comercio)';
  end if;
end;
$$;
revoke all on function public.cancel_my_order(uuid) from public;
grant execute on function public.cancel_my_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_order: comercio con cuenta => su propia empresa; created_by = usuario
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
  v_tariff      text := nullif(p->>'tariff', '');
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
    recipient_payment, agency_name, agency_destination, recipient_dni,
    destination_lat, destination_lng, tariff, tariff_zone, total_amount, created_by
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
    v_tariff, nullif(btrim(p->>'tariff_zone'), ''), v_fee, auth.uid()
  ) returning id, order_number into v_order_id, v_order_no;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_no, 'pickup_id', v_pickup_id);
end;
$function$;

revoke all on function public.submit_order(jsonb) from public;
grant execute on function public.submit_order(jsonb) to anon, authenticated;
