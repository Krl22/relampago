alter table public.chat_credentials drop constraint chat_credentials_provider_check;
alter table public.chat_credentials add constraint chat_credentials_provider_check check(provider in ('openai','anthropic','deepseek','openrouter'));
alter table public.chat_requests drop constraint chat_requests_provider_check;
alter table public.chat_requests add constraint chat_requests_provider_check check(provider in ('openai','anthropic','deepseek','openrouter'));
alter table public.chat_telegram_accounts drop constraint chat_telegram_accounts_provider_check;
alter table public.chat_telegram_accounts add constraint chat_telegram_accounts_provider_check check(provider in ('openai','anthropic','deepseek','openrouter'));

-- Exact model IDs and dated standard USD tariffs. Unknown/tiered prices stay unknown.
create table public.chat_model_prices(
 provider text not null check(provider in ('openai','anthropic','deepseek')),
 model text not null, input_per_million numeric(16,8) not null check(input_per_million>=0),
 output_per_million numeric(16,8) not null check(output_per_million>=0),
 cached_per_million numeric(16,8) not null check(cached_per_million>=0),
 write_short_per_million numeric(16,8),write_long_per_million numeric(16,8),
 max_input_tokens bigint not null default 100000,source_url text not null,price_note text not null,
 verified_at timestamptz not null default now(),valid_until timestamptz not null default now()+interval '30 days',
 primary key(provider,model)
);
alter table public.chat_model_prices enable row level security;
revoke all on public.chat_model_prices from public,anon,authenticated;
grant all on public.chat_model_prices to service_role;

insert into public.chat_model_prices(provider,model,input_per_million,output_per_million,cached_per_million,write_short_per_million,write_long_per_million,source_url,price_note) values
 ('openai','gpt-6-astra',10,50,1,12.5,25,'https://developers.openai.com/api/docs/pricing','Tarifa estándar; estimación, no factura.'),
 ('openai','gpt-6.1-sol',2,10,0.1,2.5,5,'https://developers.openai.com/api/docs/pricing','Tarifa estándar; estimación, no factura.'),
 ('openai','gpt-6.1-terra',1,5,0.05,1.25,2.5,'https://developers.openai.com/api/docs/pricing','Tarifa estándar; estimación, no factura.'),
 ('openai','gpt-6-luna',0.1,0.5,0.01,0.125,0.25,'https://developers.openai.com/api/docs/pricing','Tarifa estándar; estimación, no factura.'),
 ('anthropic','claude-sonnet-5-5',2,10,0.1,2.5,4,'https://platform.claude.com/docs/en/about-claude/pricing','Tarifa estándar; estimación, no factura.'),
 ('anthropic','claude-opus-5-5',4,20,0.2,5,8,'https://platform.claude.com/docs/en/about-claude/pricing','Tarifa estándar; estimación, no factura.'),
 ('anthropic','claude-haiku-5-5',0.1,0.5,0.01,0.125,0.2,'https://platform.claude.com/docs/en/about-claude/pricing','Tarifa hasta 100.000 tokens de entrada; estimación.'),
 ('anthropic','claude-sonnet-4-6',3,15,0.3,3.75,6,'https://platform.claude.com/docs/en/about-claude/pricing','Tarifa estándar; estimación, no factura.'),
 ('anthropic','claude-sonnet-4-5',3,15,0.3,3.75,6,'https://platform.claude.com/docs/en/about-claude/pricing','Tarifa estándar; estimación, no factura.'),
 ('anthropic','claude-opus-4-6',5,25,0.5,6.25,10,'https://platform.claude.com/docs/en/about-claude/pricing','Tarifa estándar; estimación, no factura.'),
 ('anthropic','claude-haiku-4-5',1,5,0.1,1.25,2,'https://platform.claude.com/docs/en/about-claude/pricing','Tarifa estándar; estimación, no factura.'),
 ('deepseek','deepseek-flash',0.3,1.2,0.006,null,null,'https://api-docs.deepseek.com/quick_start/pricing/','Estimación con tarifa máxima de hora punta. Horarios y festivos pueden reducir el cargo.'),
 ('deepseek','deepseek-v4-pro',1.32,3.96,0.044,null,null,'https://api-docs.deepseek.com/quick_start/pricing/','Estimación con tarifa máxima de hora punta. Horarios y festivos pueden reducir el cargo.');

-- Ledger remains after conversation deletion; it contains no messages or credentials.
create table public.chat_usage_calls(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id uuid references public.chat_conversations(id) on delete set null,
 request_id uuid references public.chat_requests(id) on delete set null,turn_id uuid not null,
 step smallint not null check(step between 0 and 3),provider text not null check(provider in ('openai','anthropic','deepseek','openrouter')),
 model text not null check(length(model) between 1 and 150),channel text not null check(channel in ('web','telegram')),
 state text not null default 'pending' check(state in ('pending','received','unconfirmed')),
 input_tokens bigint check(input_tokens between 0 and 1000000000),output_tokens bigint check(output_tokens between 0 and 1000000000),
 cached_tokens bigint check(cached_tokens>=0),cache_write_tokens bigint check(cache_write_tokens>=0),reasoning_tokens bigint check(reasoning_tokens>=0),
 cost_usd numeric(20,12) check(cost_usd>=0),cost_kind text not null default 'unknown' check(cost_kind in ('reported','estimated','unknown')),
 price_source text,price_note text,price_verified_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(turn_id,step),
 check((cost_kind='unknown' and cost_usd is null) or (cost_kind<>'unknown' and cost_usd is not null))
);
create index chat_usage_user_created on public.chat_usage_calls(user_id,created_at desc);
create index chat_usage_conversation on public.chat_usage_calls(conversation_id) where conversation_id is not null;
create index chat_usage_request on public.chat_usage_calls(request_id) where request_id is not null;
alter table public.chat_usage_calls enable row level security;
revoke all on public.chat_usage_calls from public,anon,authenticated;
grant select on public.chat_usage_calls to authenticated;
grant all on public.chat_usage_calls to service_role;
create policy chat_usage_own on public.chat_usage_calls for select to authenticated using(user_id=(select auth.uid()));

create function public.chat_usage_summary(p_from date,p_to date,p_provider text default null,p_conversation_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
 if (select auth.uid()) is null then raise exception 'not_authorized' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then raise exception 'invalid_date_range';end if;
 if p_provider is not null and p_provider not in ('openai','anthropic','deepseek','openrouter') then raise exception 'invalid_provider';end if;
 with filtered as materialized(
  select * from public.chat_usage_calls where user_id=(select auth.uid())
   and created_at >= (p_from::timestamp at time zone 'America/Lima') and created_at < ((p_to+1)::timestamp at time zone 'America/Lima')
   and (p_provider is null or provider=p_provider) and (p_conversation_id is null or conversation_id=p_conversation_id)
 ), totals as(
  select count(*) as calls,count(distinct turn_id) as queries,coalesce(sum(input_tokens),0) as input_tokens,coalesce(sum(output_tokens),0) as output_tokens,
   coalesce(sum(cached_tokens),0) as cached_tokens,coalesce(sum(reasoning_tokens),0) as reasoning_tokens,
   coalesce(sum(cost_usd) filter(where cost_kind='reported'),0) as reported_usd,coalesce(sum(cost_usd) filter(where cost_kind='estimated'),0) as estimated_usd,
   count(*) filter(where cost_kind='unknown') as unpriced_calls,count(*) filter(where input_tokens is null or output_tokens is null) as unmetered_calls,
   count(*) filter(where state<>'received') as unconfirmed_calls from filtered
 ),models as(
  select provider,model,count(*) as calls,coalesce(sum(input_tokens),0)+coalesce(sum(output_tokens),0) as tokens,
   coalesce(sum(cost_usd) filter(where cost_kind='reported'),0) as reported_usd,coalesce(sum(cost_usd) filter(where cost_kind='estimated'),0) as estimated_usd,
   count(*) filter(where cost_kind='unknown') as unpriced_calls from filtered group by provider,model order by count(*) desc,provider,model limit 100
 ),conversations as(
  select f.conversation_id,coalesce(c.title,'Conversación eliminada') as title,count(*) as calls,coalesce(sum(f.input_tokens),0)+coalesce(sum(f.output_tokens),0) as tokens,
   coalesce(sum(f.cost_usd) filter(where f.cost_kind='reported'),0) as reported_usd,coalesce(sum(f.cost_usd) filter(where f.cost_kind='estimated'),0) as estimated_usd,
   count(*) filter(where f.cost_kind='unknown') as unpriced_calls,max(f.created_at) as last_at
  from filtered f left join public.chat_conversations c on c.id=f.conversation_id and c.user_id=(select auth.uid())
  group by f.conversation_id,c.title order by max(f.created_at) desc limit 50
 ),recent as(
  select id,request_id,provider,model,channel,step,state,input_tokens,output_tokens,cost_usd,cost_kind,price_note,price_verified_at,created_at
   from filtered order by created_at desc,id desc limit 30
 )select jsonb_build_object('totals',(select to_jsonb(t) from totals t),'models',coalesce((select jsonb_agg(to_jsonb(m)) from models m),'[]'::jsonb),
  'conversations',coalesce((select jsonb_agg(to_jsonb(c)) from conversations c),'[]'::jsonb),'recent',coalesce((select jsonb_agg(to_jsonb(r)) from recent r),'[]'::jsonb),
  'tracking_since',(select min(created_at) from public.chat_usage_calls where user_id=(select auth.uid())),'timezone','America/Lima') into v_result;
 return v_result;
end;
$$;
revoke all on function public.chat_usage_summary(date,date,text,uuid) from public,anon;
grant execute on function public.chat_usage_summary(date,date,text,uuid) to authenticated;
