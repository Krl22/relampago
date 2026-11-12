-- Invoker functions retain RLS and validate the administrator from profiles,
-- never from editable JWT user_metadata. Export is a single consistent snapshot.
create or replace function public.admin_export_orders(p_ids uuid[] default null)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Solo un administrador puede descargar el respaldo.' using errcode = '42501';
  end if;
  return (
    with chosen as materialized (
      select * from public.orders where p_ids is null or id = any(p_ids)
    )
    select jsonb_build_object(
      'schema_version', 1,
      'exported_at', statement_timestamp(),
      'scope', case when p_ids is null then 'all_orders' else 'selected_orders' end,
      'photos', 'URLs only; image files remain in Supabase Storage',
      'orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.order_number) from chosen o), '[]'::jsonb),
      'deliveries', coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.deliveries d where d.order_id in (select id from chosen)), '[]'::jsonb),
      'order_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.order_events e where e.order_id in (select id from chosen)), '[]'::jsonb),
      'order_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id in (select id from chosen)), '[]'::jsonb),
      'stock_movements', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.order_id in (select id from chosen)), '[]'::jsonb),
      'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'invoice_igv', c.invoice_igv, 't1_rate', c.t1_rate) order by c.id) from public.companies c where c.id in (select company_id from chosen)), '[]'::jsonb),
      'couriers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by p.id) from public.profiles p where p.id in (select assigned_courier from chosen)), '[]'::jsonb),
      'pickups', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.pickups p where p.id in (select pickup_id from chosen)), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.admin_delete_orders(p_ids uuid[])
returns uuid[]
language plpgsql security invoker set search_path = ''
as $$
declare
  v_ids uuid[];
  v_deleted uuid[];
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Solo un administrador puede eliminar varios pedidos.' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_ids) as x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > 10000 then
    raise exception 'Selecciona entre 1 y 10000 pedidos.';
  end if;
  with deleted as (
    delete from public.orders where id = any(v_ids) returning id
  ) select coalesce(array_agg(id), '{}'::uuid[]) into v_deleted from deleted;
  if cardinality(v_deleted) <> cardinality(v_ids) then
    -- Raising here rolls back the entire call, including child cascades.
    raise exception 'La selección cambió o faltan permisos. Recarga antes de eliminar.';
  end if;
  return v_deleted;
end;
$$;

revoke all on function public.admin_export_orders(uuid[]) from public, anon;
revoke all on function public.admin_delete_orders(uuid[]) from public, anon;
grant execute on function public.admin_export_orders(uuid[]) to authenticated;
grant execute on function public.admin_delete_orders(uuid[]) to authenticated;
notify pgrst, 'reload schema';
