-- Liquidaciones por comercio: el reporte que se le entrega a cada cliente.
--   recaudado = Σ monto cobrado de entregados cuyo dinero quedó en Relámpago (Motorizado / Relampago Courier / Izipay)
--   servicio  = Σ monto del servicio (tarifa + recarga [+ 5% Izipay] [+ IGV])
--   saldo     = recaudado − servicio  (>0 Relámpago paga al comercio; <0 el comercio paga a Relámpago)
create table if not exists public.settlements (
  id            uuid primary key default gen_random_uuid(),
  settlement_number bigint generated always as identity,
  company_id    uuid not null references public.companies(id) on delete cascade,
  period_from   date not null,
  period_to     date not null,
  collected     numeric not null default 0,
  service       numeric not null default 0,
  balance       numeric not null default 0,
  orders_count  integer not null default 0,
  notes         text,
  paid_at       timestamptz,               -- cuándo se pagó/cobró el saldo
  paid_reference text,                     -- nro. de operación Yape, etc.
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists settlements_company_idx on public.settlements (company_id, period_to desc);

alter table public.orders add column if not exists settlement_id uuid references public.settlements(id) on delete set null;
create index if not exists orders_settlement_idx on public.orders (settlement_id);

alter table public.settlements enable row level security;
drop policy if exists "staff_manage_settlements" on public.settlements;
create policy "staff_manage_settlements" on public.settlements
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "client_read_own_settlements" on public.settlements;
create policy "client_read_own_settlements" on public.settlements
  for select to authenticated
  using (company_id = (select company_id from public.profiles where id = auth.uid()));
