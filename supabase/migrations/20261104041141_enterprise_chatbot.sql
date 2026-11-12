-- BYOK secrets are only accessible to the Edge Function's service role.
-- Business data is deliberately NOT exposed through SECURITY DEFINER functions.
create table public.chat_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic')),
  encrypted_key text not null check (length(encrypted_key) between 20 and 16000),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.chat_credentials enable row level security;
revoke all on public.chat_credentials from public, anon, authenticated;
grant all on public.chat_credentials to service_role;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Nueva conversación' check (length(title) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index chat_conversations_user_updated on public.chat_conversations (user_id, updated_at desc);
alter table public.chat_conversations enable row level security;
revoke all on public.chat_conversations from public, anon, authenticated;
grant select, insert, delete on public.chat_conversations to authenticated;
grant all on public.chat_conversations to service_role;
create policy chat_conversations_read on public.chat_conversations for select to authenticated
  using (user_id = (select auth.uid()));
create policy chat_conversations_create on public.chat_conversations for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy chat_conversations_delete on public.chat_conversations for delete to authenticated
  using (user_id = (select auth.uid()));

create table public.chat_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  provider text not null check (provider in ('openai', 'anthropic')),
  model text not null check (length(model) between 1 and 150),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '120 seconds',
  foreign key (conversation_id, user_id) references public.chat_conversations(id, user_id) on delete cascade
);
create index chat_requests_user_created on public.chat_requests (user_id, created_at desc);
alter table public.chat_requests enable row level security;
revoke all on public.chat_requests from public, anon, authenticated;
grant all on public.chat_requests to service_role;

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null references public.chat_requests(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 24000),
  status text not null check (status in ('pending', 'completed', 'failed')),
  provider text not null,
  model text not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (conversation_id, user_id) references public.chat_conversations(id, user_id) on delete cascade,
  unique (request_id, role)
);
create index chat_messages_conversation_created on public.chat_messages (conversation_id, created_at desc, id desc);
create index chat_messages_user on public.chat_messages (user_id);
alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from public, anon, authenticated;
grant select on public.chat_messages to authenticated;
grant all on public.chat_messages to service_role;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (user_id = (select auth.uid()));

create table public.chat_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  remind_at timestamptz,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
create index chat_notes_user_due on public.chat_notes (user_id, remind_at) where not completed;
alter table public.chat_notes enable row level security;
revoke all on public.chat_notes from public, anon, authenticated;
grant select, insert, update, delete on public.chat_notes to authenticated;
grant all on public.chat_notes to service_role;
create policy chat_notes_read on public.chat_notes for select to authenticated
  using (user_id = (select auth.uid()));
create policy chat_notes_create on public.chat_notes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy chat_notes_update on public.chat_notes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chat_notes_delete on public.chat_notes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Only the authenticated Edge Function calls these with the validated caller ID.
-- Row locks serialize requests across tabs/instances; no in-memory rate limiter.
create function public.chat_begin_turn(p_user_id uuid, p_conversation_id uuid, p_request_id uuid,
  p_provider text, p_model text, p_content text)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_status text;
begin
  if length(p_content) not between 1 and 8000 then raise exception 'invalid_content'; end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'missing_profile'; end if;
  perform 1 from public.chat_conversations where id = p_conversation_id and user_id = p_user_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  select status into v_status from public.chat_requests
    where id = p_request_id and user_id = p_user_id and conversation_id = p_conversation_id;
  if found then return v_status; end if;
  update public.chat_messages m set status = 'failed' from public.chat_requests r
    where m.request_id = r.id and r.user_id = p_user_id and r.status = 'running'
      and r.expires_at <= now() and m.status = 'pending';
  update public.chat_requests set status = 'failed'
    where user_id = p_user_id and status = 'running' and expires_at <= now();
  if exists (select 1 from public.chat_requests where user_id = p_user_id and status = 'running') then
    raise exception 'request_in_progress';
  end if;
  if (select count(*) from public.chat_requests where user_id = p_user_id
      and created_at > now() - interval '1 minute') >= 6 then raise exception 'rate_limit'; end if;
  insert into public.chat_requests(id, user_id, conversation_id, provider, model)
    values (p_request_id, p_user_id, p_conversation_id, p_provider, p_model);
  insert into public.chat_messages(conversation_id, user_id, request_id, role, content, status, provider, model)
    values (p_conversation_id, p_user_id, p_request_id, 'user', p_content, 'pending', p_provider, p_model);
  update public.chat_conversations set updated_at = clock_timestamp(),
    title = case when title = 'Nueva conversación' then left(p_content, 80) else title end
    where id = p_conversation_id and user_id = p_user_id;
  return 'started';
end;
$$;

create function public.chat_finish_turn(p_user_id uuid, p_request_id uuid, p_content text)
returns void language plpgsql security invoker set search_path = '' as $$
declare r public.chat_requests%rowtype;
begin
  select * into r from public.chat_requests where id = p_request_id and user_id = p_user_id for update;
  if not found or r.status <> 'running' or r.expires_at <= now() then raise exception 'request_expired'; end if;
  if p_content is not null then
    insert into public.chat_messages(conversation_id, user_id, request_id, role, content, status, provider, model)
      values (r.conversation_id, r.user_id, r.id, 'assistant', p_content, 'completed', r.provider, r.model);
  end if;
  update public.chat_messages set status = case when p_content is null then 'failed' else 'completed' end
    where request_id = r.id and role = 'user';
  update public.chat_requests set status = case when p_content is null then 'failed' else 'completed' end where id = r.id;
  update public.chat_conversations set updated_at = clock_timestamp() where id = r.conversation_id;
end;
$$;
revoke all on function public.chat_begin_turn(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.chat_finish_turn(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.chat_begin_turn(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.chat_finish_turn(uuid, uuid, text) to service_role;

-- Fixed read-only API, under the caller's RLS. No dynamic SQL or model-supplied columns.
create function public.chat_order_summary(p_from date, p_to date, p_status text default null)
returns table(status text, total bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then
    raise exception 'invalid_date_range';
  end if;
  return query select o.status::text, count(*) from public.orders o
    join public.profiles p on p.id = (select auth.uid())
    where o.scheduled_date between p_from and p_to
      and (p_status is null or o.status::text = p_status)
      and (p.role::text in ('admin', 'staff')
        or (p.role::text = 'client' and o.company_id = p.company_id)
        or (p.role::text = 'courier' and o.assigned_courier = p.id))
    group by o.status;
end;
$$;
revoke all on function public.chat_order_summary(date, date, text) from public, anon;
grant execute on function public.chat_order_summary(date, date, text) to authenticated;
