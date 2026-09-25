-- Seguridad: el rol de un usuario nuevo ya NO se toma del metadata que manda el cliente.
-- Antes, cualquiera con la anon key podía hacer signUp({ data: { role: 'admin' } }) y
-- convertirse en admin. Ahora todo usuario nuevo nace como 'client'; solo un admin/staff
-- puede subirlo a 'courier'/'staff'/'admin' (la pantalla de Motorizados ya hace ese upsert).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'client')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper reutilizable para policies: ¿el usuario actual es admin o staff?
-- security definer para no depender de la policy de lectura de profiles.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'staff')
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated, anon;
