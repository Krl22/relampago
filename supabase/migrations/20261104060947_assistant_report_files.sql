-- Private report artifacts. Business tables remain read-only to the assistant.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('enterprise-chat-reports','enterprise-chat-reports',false,10485760,array[
 'application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.chat_reports(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id uuid,
 request_id uuid references public.chat_requests(id) on delete set null,
 dataset text not null check(dataset in ('orders','notes','activity')),
 format text not null check(format in ('xlsx','docx','pdf')),
 fingerprint text not null,
 filename text not null,
 storage_path text not null unique,
 status text not null default 'generating' check(status in ('generating','ready','failed')),
 row_count integer not null default 0 check(row_count between 0 and 2000),
 byte_size integer not null default 0 check(byte_size between 0 and 10485760),
 access_scope jsonb not null default '{}'::jsonb,
 source_ids uuid[] not null default '{}',
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 foreign key(conversation_id,user_id) references public.chat_conversations(id,user_id) on delete set null(conversation_id),
 unique(request_id,fingerprint)
);
create index chat_reports_owner_request on public.chat_reports(user_id,request_id);
create index chat_reports_expiry on public.chat_reports(expires_at);
create index chat_reports_conversation on public.chat_reports(conversation_id);
alter table public.chat_reports enable row level security;
revoke all on public.chat_reports from public,anon,authenticated;
grant select on public.chat_reports to authenticated;
grant all on public.chat_reports to service_role;
create policy chat_reports_owner on public.chat_reports for select to authenticated using(user_id=(select auth.uid()));

alter table public.chat_telegram_deliveries add column report_id uuid references public.chat_reports(id) on delete set null;
create index chat_telegram_deliveries_report on public.chat_telegram_deliveries(report_id) where report_id is not null;
alter table public.chat_telegram_deliveries drop constraint chat_telegram_deliveries_kind_check;
alter table public.chat_telegram_deliveries add constraint chat_telegram_deliveries_kind_check check(kind in ('reply','reminder','link','notice','document'));

-- Fixed snapshot query, independent from the 50-row chat sample and PostgREST's row limit.
create function public.chat_report_data(p_dataset text,p_from date default null,p_to date default null,p_status text default null,
 p_actor_id uuid default null,p_viewer_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_viewer uuid;v_role text;v_company uuid;v_rows jsonb;v_ids uuid[];v_total numeric;
begin
 if current_user='service_role' then v_viewer:=p_viewer_id;
 else
  v_viewer:=(select auth.uid());
  if p_viewer_id is not null and p_viewer_id is distinct from v_viewer then raise exception 'not_authorized' using errcode='42501';end if;
 end if;
 select role::text,company_id into v_role,v_company from public.profiles where id=v_viewer;
 if v_viewer is null or v_role is null or v_role not in ('admin','staff','courier','client') or (v_role='client' and v_company is null)
  then raise exception 'not_authorized' using errcode='42501';end if;
 if p_from is not null and p_to is not null and (p_to<p_from or p_to-p_from>365) then raise exception 'invalid_date_range';end if;
 if p_status is not null and p_status not in ('pending','picked_up','in_transit','delivered','failed','cancelled') then raise exception 'invalid_status';end if;
 if p_dataset='orders' then
  if p_from is null or p_to is null or p_actor_id is not null then raise exception 'invalid_order_filters';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.scheduled_date,x.order_number,x.id),'[]'::jsonb),coalesce(array_agg(x.id),'{}'::uuid[])
   into v_rows,v_ids from(
    select o.id,o.order_number,o.scheduled_date,o.status::text,o.destination_district,o.packages_count,
     o.total_amount,o.amount_to_collect,o.amount_collected
    from public.orders o where o.scheduled_date between p_from and p_to and (p_status is null or o.status::text=p_status)
     and (v_role in ('admin','staff') or (v_role='client' and o.company_id=v_company) or (v_role='courier' and o.assigned_courier=v_viewer))
    order by o.scheduled_date,o.order_number,o.id limit 2001
   )x;
 elsif p_dataset='notes' then
  if p_status is not null or p_actor_id is not null then raise exception 'invalid_note_filters';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb),coalesce(array_agg(x.id),'{}'::uuid[])
   into v_rows,v_ids from(
    select n.id,n.body,n.created_at,n.remind_at from public.chat_notes n where n.user_id=v_viewer and not n.completed
     and (p_from is null or n.created_at >= (p_from::timestamp at time zone 'America/Lima'))
     and (p_to is null or n.created_at < ((p_to+1)::timestamp at time zone 'America/Lima'))
    order by n.created_at,n.id limit 2001
   )x;
 elsif p_dataset='activity' then
  if v_role not in ('admin','staff') then raise exception 'not_authorized' using errcode='42501';end if;
  if p_status is not null then raise exception 'invalid_activity_filters';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb),coalesce(array_agg(distinct x.order_id),'{}'::uuid[])
   into v_rows,v_ids from(
    select e.id,e.order_id,o.order_number,e.actor_id,p.full_name as actor_name,e.event_type,e.from_status,e.to_status,e.created_at
    from public.order_events e join public.orders o on o.id=e.order_id left join public.profiles p on p.id=e.actor_id
    where (p_actor_id is null or e.actor_id=p_actor_id)
     and (p_from is null or e.created_at >= (p_from::timestamp at time zone 'America/Lima'))
     and (p_to is null or e.created_at < ((p_to+1)::timestamp at time zone 'America/Lima'))
    order by e.created_at,e.id limit 2001
   )x;
 else raise exception 'invalid_dataset';end if;
 if jsonb_array_length(v_rows)>2000 then raise exception 'report_row_limit';end if;
 select coalesce(sum((value->>'total_amount')::numeric),0) into v_total from jsonb_array_elements(v_rows);
 return jsonb_build_object('dataset',p_dataset,'rows',v_rows,'source_ids',v_ids,'total_service_amount',v_total,
  'scope',jsonb_build_object('role',v_role,'company_id',v_company),'generated_at',now(),'from',p_from,'to',p_to,'status',p_status,
  'timezone','America/Lima','coverage',case when p_dataset='activity' then
   'Solo creación de pedidos, cambios de estado y asignación. No es una auditoría completa de ediciones ni de sesiones.'
   when p_dataset='notes' then 'Notas personales pendientes; fechas filtradas por creación de la nota.'
   else 'Pedidos permitidos por fecha programada. Importe del servicio no equivale a dinero cobrado.' end);
end;
$$;

-- Revalidate current scope and row access before signing or sending an artifact.
create function public.chat_authorize_report(p_report_id uuid,p_viewer_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r public.chat_reports%rowtype;v_viewer uuid;v_role text;v_company uuid;v_allowed integer;
begin
 if current_user='service_role' then v_viewer:=p_viewer_id;
 else
  v_viewer:=(select auth.uid());
  if p_viewer_id is not null and p_viewer_id is distinct from v_viewer then raise exception 'not_authorized' using errcode='42501';end if;
 end if;
 select role::text,company_id into v_role,v_company from public.profiles where id=v_viewer;
 select * into r from public.chat_reports where id=p_report_id and user_id=v_viewer;
 if not found or v_role is null or r.status<>'ready' or r.expires_at<=now() or r.conversation_id is null or r.request_id is null then return null;end if;
 if r.access_scope->>'role' is distinct from v_role or r.access_scope->>'company_id' is distinct from v_company::text then return null;end if;
 if r.dataset='activity' and v_role not in ('admin','staff') then return null;end if;
 if r.dataset in ('orders','activity') then
  select count(*)::integer into v_allowed from public.orders o where o.id=any(r.source_ids)
   and (v_role in ('admin','staff') or (v_role='client' and o.company_id=v_company) or (v_role='courier' and o.assigned_courier=v_viewer));
 else select count(*)::integer into v_allowed from public.chat_notes n where n.id=any(r.source_ids) and n.user_id=v_viewer;end if;
 if v_allowed<>cardinality(r.source_ids) then return null;end if;
 return jsonb_build_object('id',r.id,'storage_path',r.storage_path,'filename',r.filename,'format',r.format,'byte_size',r.byte_size,'row_count',r.row_count);
end;
$$;
revoke all on function public.chat_report_data(text,date,date,text,uuid,uuid) from public,anon;
revoke all on function public.chat_authorize_report(uuid,uuid) from public,anon;
grant execute on function public.chat_report_data(text,date,date,text,uuid,uuid) to authenticated,service_role;
grant execute on function public.chat_authorize_report(uuid,uuid) to authenticated,service_role;

create function public.chat_report_orphans()
returns setof text language sql stable security invoker set search_path='' as $$
 select o.name from storage.objects o left join public.chat_reports r on r.storage_path=o.name
 where o.bucket_id='enterprise-chat-reports' and o.created_at<now()-interval '24 hours'
   and (r.id is null or r.expires_at<=now()) order by o.created_at limit 20;
$$;
revoke all on function public.chat_report_orphans() from public,anon,authenticated;
grant execute on function public.chat_report_orphans() to service_role;
