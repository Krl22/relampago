-- All Telegram credentials, linking challenges and queues are backend-only.
create table public.chat_telegram_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bot_id bigint not null unique check (bot_id > 0),
  bot_username text not null,
  encrypted_token text not null,
  webhook_id uuid not null unique default gen_random_uuid(),
  webhook_secret_hash text not null,
  link_hash text,
  link_expires_at timestamptz,
  pending_telegram_id bigint,
  pending_name text,
  confirmation_hash text,
  confirmation_attempts integer not null default 0,
  telegram_id bigint check (telegram_id > 0),
  telegram_name text,
  linked_at timestamptz,
  provider text not null default 'openai' check (provider in ('openai','anthropic')),
  model text check (length(model) between 1 and 150),
  conversation_id uuid,
  reminders_enabled boolean not null default false,
  blocked boolean not null default false,
  last_delivery_error text,
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.chat_conversations(id, user_id) on delete set null (conversation_id)
);
alter table public.chat_telegram_accounts enable row level security;
revoke all on public.chat_telegram_accounts from public, anon, authenticated;
grant all on public.chat_telegram_accounts to service_role;

create table public.chat_telegram_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.chat_telegram_accounts(user_id) on delete cascade,
  bot_id bigint not null,
  update_id bigint not null,
  telegram_id bigint not null,
  content text not null check (length(content) between 1 and 8000),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, bot_id, update_id)
);
create index chat_telegram_updates_pending on public.chat_telegram_updates (available_at,created_at) where status in ('queued','processing');
alter table public.chat_telegram_updates enable row level security;
revoke all on public.chat_telegram_updates from public, anon, authenticated;
grant all on public.chat_telegram_updates to service_role;

create table public.chat_telegram_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.chat_telegram_accounts(user_id) on delete cascade,
  bot_id bigint not null,
  telegram_id bigint not null,
  kind text not null check (kind in ('reply','reminder','link')),
  source_id uuid not null,
  part integer not null default 0,
  note_id uuid references public.chat_notes(id) on delete cascade,
  body text not null check (length(body) between 1 and 3500),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','uncertain','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, kind, source_id, part)
);
create index chat_telegram_deliveries_pending on public.chat_telegram_deliveries (available_at,created_at,part) where status='pending';
create index chat_telegram_deliveries_note on public.chat_telegram_deliveries(note_id) where note_id is not null;
alter table public.chat_telegram_deliveries enable row level security;
revoke all on public.chat_telegram_deliveries from public, anon, authenticated;
grant all on public.chat_telegram_deliveries to service_role;

-- Two-step linking. Failed codes consume an attempt without rolling it back.
create function public.chat_telegram_confirm(p_user_id uuid, p_hash text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.chat_telegram_accounts%rowtype;
begin
  select * into a from public.chat_telegram_accounts where user_id=p_user_id for update;
  if not found or a.pending_telegram_id is null or a.confirmation_hash is null
    or a.link_expires_at is null or a.link_expires_at <= now() or a.confirmation_attempts >= 5 then return false; end if;
  if a.confirmation_hash <> p_hash then
    update public.chat_telegram_accounts set confirmation_attempts=confirmation_attempts+1 where user_id=p_user_id;
    return false;
  end if;
  update public.chat_telegram_accounts set telegram_id=pending_telegram_id, telegram_name=pending_name,
    linked_at=now(), pending_telegram_id=null, pending_name=null, confirmation_hash=null,
    link_hash=null, link_expires_at=null, confirmation_attempts=0, blocked=false, last_delivery_error=null
    where user_id=p_user_id;
  return true;
end;
$$;

-- A fixed service-only query for verified Telegram identities, not a user-callable impersonation API.
-- Explicit role/company/assignment scope is applied because Telegram has no Supabase browser JWT.
create function public.chat_service_order_summary(p_user_id uuid,p_from date,p_to date,p_status text default null)
returns table(status text,total bigint) language plpgsql stable security invoker set search_path='' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to-p_from > 30 then raise exception 'invalid_date_range'; end if;
  return query select o.status::text,count(*) from public.orders o join public.profiles p on p.id=p_user_id
    where o.scheduled_date between p_from and p_to and (p_status is null or o.status::text=p_status)
      and (p.role::text in ('admin','staff') or (p.role::text='client' and p.company_id=o.company_id)
        or (p.role::text='courier' and p.id=o.assigned_courier)) group by o.status;
end;
$$;

create function public.chat_telegram_claim_update()
returns setof public.chat_telegram_updates language sql security invoker set search_path='' as $$
  update public.chat_telegram_updates set status='processing',attempts=attempts+1,lease_until=now()+interval '3 minutes'
  where id=(select id from public.chat_telegram_updates where attempts < 4 and
    ((status='queued' and available_at<=now()) or (status='processing' and lease_until<now()))
    order by created_at,id limit 1 for update skip locked) returning *;
$$;

create function public.chat_telegram_claim_delivery()
returns setof public.chat_telegram_deliveries language sql security invoker set search_path='' as $$
  update public.chat_telegram_deliveries set status='sending',attempts=attempts+1,started_at=now()
  where id=(select d.id from public.chat_telegram_deliveries d where status='pending' and available_at<=now() and attempts<5
    and not exists (select 1 from public.chat_telegram_deliveries earlier where earlier.user_id=d.user_id
      and earlier.source_id=d.source_id and earlier.part<d.part and earlier.status not in ('sent','skipped'))
    order by created_at,part,id limit 1 for update skip locked) returning *;
$$;

-- Enqueue each one-off reminder once, independently of whether the website is open.
create function public.chat_telegram_enqueue_reminders()
returns void language sql security invoker set search_path='' as $$
  insert into public.chat_telegram_deliveries(user_id,bot_id,telegram_id,kind,source_id,note_id,body)
  select n.user_id,a.bot_id,a.telegram_id,'reminder',n.id,n.id,
    '🔔 Recordatorio' || chr(10) || left(n.body,3400)
  from public.chat_notes n join public.chat_telegram_accounts a on a.user_id=n.user_id
  where n.remind_at<=now() and not n.completed and a.telegram_id is not null and a.reminders_enabled and not a.blocked
    and not exists(select 1 from public.chat_telegram_deliveries d where d.user_id=n.user_id and d.kind='reminder' and d.source_id=n.id)
  order by n.remind_at limit 100 on conflict (user_id,kind,source_id,part) do nothing;
$$;

revoke all on function public.chat_telegram_confirm(uuid,text) from public,anon,authenticated;
revoke all on function public.chat_service_order_summary(uuid,date,date,text) from public,anon,authenticated;
revoke all on function public.chat_telegram_claim_update() from public,anon,authenticated;
revoke all on function public.chat_telegram_claim_delivery() from public,anon,authenticated;
revoke all on function public.chat_telegram_enqueue_reminders() from public,anon,authenticated;
grant execute on function public.chat_telegram_confirm(uuid,text) to service_role;
grant execute on function public.chat_service_order_summary(uuid,date,date,text) to service_role;
grant execute on function public.chat_telegram_claim_update() to service_role;
grant execute on function public.chat_telegram_claim_delivery() to service_role;
grant execute on function public.chat_telegram_enqueue_reminders() to service_role;

create function public.chat_telegram_prepare_link(p_webhook_id uuid,p_link_hash text,p_telegram_id bigint,
  p_name text,p_confirmation_hash text,p_body text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.chat_telegram_accounts%rowtype;
begin
  select * into a from public.chat_telegram_accounts where webhook_id=p_webhook_id for update;
  if not found or a.link_hash is distinct from p_link_hash or a.link_expires_at is null or a.link_expires_at<=now()
    or a.pending_telegram_id is not null or p_telegram_id<=0 then return false; end if;
  update public.chat_telegram_accounts set pending_telegram_id=p_telegram_id,pending_name=left(p_name,100),
    confirmation_hash=p_confirmation_hash where user_id=a.user_id;
  insert into public.chat_telegram_deliveries(user_id,bot_id,telegram_id,kind,source_id,body)
    values(a.user_id,a.bot_id,p_telegram_id,'link',gen_random_uuid(),p_body);
  return true;
end;
$$;
revoke all on function public.chat_telegram_prepare_link(uuid,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.chat_telegram_prepare_link(uuid,text,bigint,text,text,text) to service_role;
