-- Formulario público: las direcciones de recojo de un negocio se pueden consultar por nombre
-- (sin datos de contacto) y las direcciones nuevas escritas en el formulario se guardan en la empresa.

create or replace function public.company_addresses_by_name(p_name text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'address', a.address, 'district', a.district)
                     order by a.is_default desc, a.created_at)
    from public.company_addresses a
    join public.companies c on c.id = a.company_id
    where lower(c.name) = lower(btrim(p_name))
  ), '[]'::jsonb);
$$;
revoke all on function public.company_addresses_by_name(text) from public;
grant execute on function public.company_addresses_by_name(text) to anon, authenticated;

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
    destination_lat, destination_lng, tariff, tariff_zone, total_amount
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
    v_tariff, nullif(btrim(p->>'tariff_zone'), ''), v_fee
  ) returning id, order_number into v_order_id, v_order_no;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_no, 'pickup_id', v_pickup_id);
end;
$$;

revoke all on function public.submit_order(jsonb) from public;
grant execute on function public.submit_order(jsonb) to anon, authenticated;
