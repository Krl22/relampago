-- Pending invitations do not grant company access. Only the Edge Function can write them.
create table public.company_access_invitations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  activated_at timestamptz
);
create index company_access_invitations_company_idx
  on public.company_access_invitations(company_id);
alter table public.company_access_invitations enable row level security;
revoke all on public.company_access_invitations from anon, authenticated;
grant select on public.company_access_invitations to authenticated;
grant all on public.company_access_invitations to service_role;
create policy staff_read_company_access_invitations
  on public.company_access_invitations for select to authenticated
  using ((select public.is_staff()));
