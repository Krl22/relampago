-- Tracking de motorizados y eventos de pedidos.
--
--  courier_locations         última posición conocida de cada motorizado (1 fila por courier, upsert)
--  courier_location_history  recorrido (se llena solo por trigger; retención 7 días)
--  order_events              auditoría de cambios de estado/asignación con la coordenada del momento

-- ---------------------------------------------------------------------------
-- courier_locations
-- ---------------------------------------------------------------------------
create table if not exists public.courier_locations (
  courier_id  uuid primary key references public.profiles(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    double precision,
  heading     double precision,
  speed       double precision,           -- m/s, lo que entrega el GPS
  recorded_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.courier_locations enable row level security;

drop policy if exists "staff_read_locations" on public.courier_locations;
create policy "staff_read_locations" on public.courier_locations
  for select to authenticated
  using (public.is_staff() or courier_id = auth.uid());

drop policy if exists "courier_insert_own_location" on public.courier_locations;
create policy "courier_insert_own_location" on public.courier_locations
  for insert to authenticated
  with check (courier_id = auth.uid());

drop policy if exists "courier_update_own_location" on public.courier_locations;
create policy "courier_update_own_location" on public.courier_locations
  for update to authenticated
  using (courier_id = auth.uid())
  with check (courier_id = auth.uid());

-- Realtime necesita la fila completa para los eventos UPDATE
alter table public.courier_locations replica identity full;

-- ---------------------------------------------------------------------------
-- courier_location_history
-- ---------------------------------------------------------------------------
create table if not exists public.courier_location_history (
  id          bigint generated always as identity primary key,
  courier_id  uuid not null references public.profiles(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    double precision,
  heading     double precision,
  speed       double precision,
  recorded_at timestamptz not null default now()
);

create index if not exists courier_location_history_courier_time_idx
  on public.courier_location_history (courier_id, recorded_at desc);

alter table public.courier_location_history enable row level security;

drop policy if exists "staff_read_location_history" on public.courier_location_history;
create policy "staff_read_location_history" on public.courier_location_history
  for select to authenticated
  using (public.is_staff() or courier_id = auth.uid());
-- Sin policy de insert: solo escribe el trigger (security definer).

create or replace function public.copy_location_to_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  insert into public.courier_location_history
    (courier_id, lat, lng, accuracy, heading, speed, recorded_at)
  values
    (new.courier_id, new.lat, new.lng, new.accuracy, new.heading, new.speed, new.recorded_at);
  return new;
end;
$$;

drop trigger if exists courier_locations_to_history on public.courier_locations;
create trigger courier_locations_to_history
  before insert or update on public.courier_locations
  for each row execute procedure public.copy_location_to_history();

-- ---------------------------------------------------------------------------
-- order_events
-- ---------------------------------------------------------------------------
create table if not exists public.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  event_type  text not null check (event_type in ('created', 'status_change', 'assigned')),
  from_status text,
  to_status   text,
  courier_id  uuid references public.profiles(id) on delete set null,  -- para 'assigned'
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at desc);
create index if not exists order_events_actor_idx on public.order_events (actor_id, created_at desc);

alter table public.order_events enable row level security;

drop policy if exists "staff_or_actor_read_order_events" on public.order_events;
create policy "staff_or_actor_read_order_events" on public.order_events
  for select to authenticated
  using (public.is_staff() or actor_id = auth.uid());
-- Sin policy de insert: solo escribe el trigger (security definer).

-- Se dispara con cualquier insert/update de orders. La coordenada sale de la
-- última posición del actor (si es motorizado y reportó hace < 2 min).
create or replace function public.log_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lat   double precision;
  v_lng   double precision;
begin
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;

  if v_actor is not null then
    select lat, lng into v_lat, v_lng
    from public.courier_locations
    where courier_id = v_actor
      and recorded_at > now() - interval '2 minutes';
  end if;

  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, actor_id, event_type, to_status, courier_id)
    values (new.id, v_actor, 'created', new.status::text, new.assigned_courier);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_events
      (order_id, actor_id, event_type, from_status, to_status, lat, lng)
    values
      (new.id, v_actor, 'status_change', old.status::text, new.status::text, v_lat, v_lng);
  end if;

  if new.assigned_courier is distinct from old.assigned_courier then
    insert into public.order_events (order_id, actor_id, event_type, courier_id)
    values (new.id, v_actor, 'assigned', new.assigned_courier);
  end if;

  return new;
end;
$$;

drop trigger if exists orders_log_event on public.orders;
create trigger orders_log_event
  after insert or update on public.orders
  for each row execute procedure public.log_order_event();

-- delivered_at nunca se escribía; ahora se marca solo al pasar a 'delivered'.
create or replace function public.set_order_delivered_at()
returns trigger
language plpgsql
as $$
begin
  if new.status::text = 'delivered' and (old.status is distinct from new.status) and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_set_delivered_at on public.orders;
create trigger orders_set_delivered_at
  before update on public.orders
  for each row execute procedure public.set_order_delivered_at();

-- ---------------------------------------------------------------------------
-- Realtime: el panel de mapa escucha courier_locations y orders
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'courier_locations'
  ) then
    alter publication supabase_realtime add table public.courier_locations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
