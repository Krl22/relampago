-- Admins y staff que también reparten.
-- "Reparte" = profiles.is_courier. Los perfiles con role = 'courier' lo tienen siempre en true
-- (lo garantiza el trigger); a un admin/staff se le activa desde la pantalla de Motorizados.

alter table public.profiles
  add column if not exists is_courier boolean not null default false;

update public.profiles set is_courier = true where role = 'courier';

create or replace function public.sync_is_courier()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'courier' then
    new.is_courier := true;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_is_courier on public.profiles;
create trigger profiles_sync_is_courier
  before insert or update on public.profiles
  for each row execute procedure public.sync_is_courier();

create index if not exists profiles_is_courier_idx on public.profiles (is_courier) where is_courier;
