-- Read existing evidence only. This migration does not add triggers or collect new activity.
create index if not exists order_events_created_id_idx on public.order_events(created_at desc,id desc);

create function public.chat_find_users(p_query text default null,p_role text default null,p_viewer_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_viewer uuid; v_role text; v_result jsonb;
begin
  if current_user='service_role' then v_viewer:=p_viewer_id;
  else
    v_viewer:=(select auth.uid());
    if p_viewer_id is not null and p_viewer_id is distinct from v_viewer then
      raise exception 'not_authorized' using errcode='42501';
    end if;
  end if;
  select role::text into v_role from public.profiles where id=v_viewer;
  if v_viewer is null or v_role is null or v_role not in ('admin','staff') then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if p_query is not null and length(btrim(p_query)) not between 2 and 100 then raise exception 'invalid_query'; end if;
  if p_role is not null and p_role not in ('admin','staff','courier','client') then raise exception 'invalid_role'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_result from (
    select id,full_name,role::text as role from public.profiles
    where (p_query is null or strpos(lower(coalesce(full_name,'')),lower(btrim(p_query)))>0)
      and (p_role is null or role::text=p_role)
    order by full_name nulls last,id limit 20
  ) x;
  return jsonb_build_object('users',v_result,'limit',20,
    'identity_note','No existe un atributo de dueño. No asumir que todo administrador es el dueño; confirmar la persona si hay ambigüedad.');
end;
$$;

create function public.chat_user_activity(p_actor_id uuid default null,p_from date default null,p_to date default null,p_viewer_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_viewer uuid; v_role text; v_events jsonb; v_actor jsonb; v_count integer;
begin
  if current_user='service_role' then v_viewer:=p_viewer_id;
  else
    v_viewer:=(select auth.uid());
    if p_viewer_id is not null and p_viewer_id is distinct from v_viewer then
      raise exception 'not_authorized' using errcode='42501';
    end if;
  end if;
  select role::text into v_role from public.profiles where id=v_viewer;
  if v_viewer is null or v_role is null or v_role not in ('admin','staff') then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if p_from is not null and p_to is not null and (p_to<p_from or p_to-p_from>365) then
    raise exception 'invalid_date_range';
  end if;
  if p_actor_id is not null then
    select jsonb_build_object('id',id,'full_name',full_name,'role',role::text) into v_actor
      from public.profiles where id=p_actor_id;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb),count(*)::integer
    into v_events,v_count from (
      select e.id,e.order_id,o.order_number,e.actor_id,p.full_name as actor_name,p.role::text as actor_role,
        e.event_type,e.from_status,e.to_status,e.courier_id,e.created_at
      from public.order_events e join public.orders o on o.id=e.order_id
        left join public.profiles p on p.id=e.actor_id
      where (p_actor_id is null or e.actor_id=p_actor_id)
        and (p_from is null or e.created_at >= (p_from::timestamp at time zone 'America/Lima'))
        and (p_to is null or e.created_at < ((p_to+1)::timestamp at time zone 'America/Lima'))
      order by e.created_at desc,e.id desc limit 51
    ) x;
  return jsonb_build_object('actor',v_actor,'source','order_events','timezone','America/Lima',
    'from',p_from,'to',p_to,'latest_recorded_event',v_events->0,
    'events',(select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) from jsonb_array_elements(v_events) with ordinality a(value,ord) where ord<=50),
    'limit',50,'truncated',v_count>50,
    'coverage',jsonb_build_object('tracked_operations',jsonb_build_array('created','status_change','assigned'),
      'records_all_database_edits',false,'records_logins_or_presence',false,
      'limitations','Solo creación de pedidos, cambios de estado y asignación. No registra todas las ediciones, lecturas ni sesiones. La ausencia de eventos no demuestra inactividad. Actor nulo no identifica a una persona. No atribuir cambios al dueño sin identificar su cuenta.'));
end;
$$;
revoke all on function public.chat_find_users(text,text,uuid) from public,anon;
revoke all on function public.chat_user_activity(uuid,date,date,uuid) from public,anon;
grant execute on function public.chat_find_users(text,text,uuid) to authenticated,service_role;
grant execute on function public.chat_user_activity(uuid,date,date,uuid) to authenticated,service_role;
