-- Actividad por comercio para el panel de Empresas: cuentas en el portal y pedidos recientes.
-- Sirve para ver a qué comercios que piden por el formulario público conviene darles su cuenta.
create or replace function public.company_activity()
returns table (company_id uuid, accounts int, orders_30d int, last_order_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id,
    (select count(*)::int from public.profiles p where p.company_id = c.id and p.role = 'client'),
    (select count(*)::int from public.orders o where o.company_id = c.id and o.created_at > now() - interval '30 days'),
    (select max(o.created_at) from public.orders o where o.company_id = c.id)
  from public.companies c
  where public.is_staff();
$$;
revoke all on function public.company_activity() from public;
grant execute on function public.company_activity() to authenticated;
