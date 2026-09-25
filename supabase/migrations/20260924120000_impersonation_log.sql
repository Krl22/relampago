-- "Ver como": un admin entra al sistema como otro usuario (motorizado, comercio o staff) para QA.
-- La sesión la emite la Edge Function admin-users (solo admins; nunca como otro admin) y cada
-- ingreso queda registrado aquí.
create table if not exists public.impersonation_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references public.profiles(id) on delete set null,
  target_id   uuid references public.profiles(id) on delete set null,
  target_role public.user_role,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists impersonation_log_started_idx on public.impersonation_log (started_at desc);
alter table public.impersonation_log enable row level security;
drop policy if exists "admin_read_impersonation_log" on public.impersonation_log;
create policy "admin_read_impersonation_log" on public.impersonation_log
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
