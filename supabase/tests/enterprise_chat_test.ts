import assert from "node:assert/strict";
import { PGlite } from "npm:@electric-sql/pglite@0.5.14";

Deno.test("Postgres migration: RLS, backend-only secrets/messages, ownership, replay, locks, rate limit and read-only summaries", async () => {
  const db = new PGlite();
  try {
    // Isolated Postgres fixture: no production connection, existing migrations/data are untouched.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users (id uuid primary key);
      create table public.profiles (id uuid primary key references auth.users(id), role text, company_id uuid);
      create table public.orders (id uuid primary key, status text, scheduled_date date, company_id uuid, assigned_courier uuid);
      alter table public.orders enable row level security;
      create policy fixture_order_scope on public.orders for select to authenticated using (
        exists (select 1 from public.profiles p where p.id = auth.uid() and
          (p.role in ('admin','staff') or (p.role = 'client' and p.company_id = orders.company_id)
          or (p.role = 'courier' and p.id = orders.assigned_courier))));
      grant usage on schema auth, public to authenticated, service_role, anon;
      grant select on public.profiles, public.orders to authenticated;
      grant all on public.profiles, public.orders to service_role;
      insert into auth.users values
        ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002'),
        ('10000000-0000-4000-8000-000000000003'), ('10000000-0000-4000-8000-000000000004');
      insert into public.profiles values
        ('10000000-0000-4000-8000-000000000001','client','20000000-0000-4000-8000-000000000001'),
        ('10000000-0000-4000-8000-000000000002','client','20000000-0000-4000-8000-000000000002'),
        ('10000000-0000-4000-8000-000000000003','courier',null),
        ('10000000-0000-4000-8000-000000000004','admin',null);
      insert into public.orders values
        (gen_random_uuid(),'pending','2026-11-03','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
        (gen_random_uuid(),'pending','2026-11-03','20000000-0000-4000-8000-000000000002',null);
    `);
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261104041141_enterprise_chatbot.sql", import.meta.url)));
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261104044051_telegram_assistant.sql", import.meta.url)));
    await db.exec(`
      alter table public.profiles add column full_name text;
      update public.profiles set full_name=case role when 'admin' then 'Admin Example' when 'courier' then 'Courier Example' else 'Client Example' end;
      alter table public.orders add column order_number bigint not null default 1;
      create table public.order_events(id bigint generated always as identity primary key,order_id uuid references public.orders(id),actor_id uuid references public.profiles(id),
        event_type text,from_status text,to_status text,courier_id uuid,created_at timestamptz);
      alter table public.order_events enable row level security;
      create policy fixture_event_scope on public.order_events for select to authenticated using (
        actor_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','staff')));
      grant select on public.order_events to authenticated;
      grant all on public.order_events to service_role;
      insert into public.order_events(order_id,actor_id,event_type,created_at)
        select id,'10000000-0000-4000-8000-000000000004','created','2026-10-01 10:00:00+00' from public.orders where company_id='20000000-0000-4000-8000-000000000001';
      insert into public.order_events(order_id,actor_id,event_type,from_status,to_status,created_at)
        select id,'10000000-0000-4000-8000-000000000004','status_change','pending','in_transit','2026-11-04 03:00:00+00' from public.orders where company_id='20000000-0000-4000-8000-000000000001';
      insert into public.order_events(order_id,actor_id,event_type,created_at)
        select id,'10000000-0000-4000-8000-000000000004','assigned','2026-11-04 05:30:00+00' from public.orders where company_id='20000000-0000-4000-8000-000000000001';
    `);
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261104053648_assistant_readonly_user_activity.sql", import.meta.url)));
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261104054538_telegram_link_feedback.sql", import.meta.url)));
    await db.exec(`
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(name text,bucket_id text,created_at timestamptz default now());
      grant usage on schema storage to service_role;grant select on storage.objects to service_role;
      alter table public.orders add column destination_district text default 'Lima';
      alter table public.orders add column packages_count integer default 1;
      alter table public.orders add column total_amount numeric default 10.50;
      alter table public.orders add column amount_to_collect numeric default 20;
      alter table public.orders add column amount_collected numeric default 0;
    `);
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261104060947_assistant_report_files.sql", import.meta.url)));
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261104071900_deepseek_provider.sql", import.meta.url)));
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261104171000_openrouter_usage.sql", import.meta.url)));
    const u1 = '10000000-0000-4000-8000-000000000001', u2 = '10000000-0000-4000-8000-000000000002';
    const c1 = '30000000-0000-4000-8000-000000000001', c2 = '30000000-0000-4000-8000-000000000002';
    const r1 = '40000000-0000-4000-8000-000000000001';
    const asUser = async (id: string) => { await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${id}'`); };
    const service = async () => { await db.exec('reset role; set role service_role'); };
    const scalar = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0])[0];
    await asUser(u1);
    await db.exec(`insert into public.chat_conversations(id) values ('${c1}'); insert into public.chat_notes(body) values ('private one')`);
    await assert.rejects(() => db.exec(`insert into public.chat_conversations(user_id) values ('${u2}')`), /row-level security/);
    await assert.rejects(() => db.exec('select * from public.chat_credentials'), /permission denied/);
    await assert.rejects(() => db.exec('select * from public.chat_requests'), /permission denied/);
    await assert.rejects(() => db.exec(`select public.chat_begin_turn('${u1}','${c1}','${r1}','openai','test-model','hello')`), /permission denied/);
    await assert.rejects(() => db.exec(`insert into public.chat_messages(role) values ('assistant')`), /permission denied/);
    assert.equal(await scalar("select total::int from public.chat_order_summary('2026-11-03','2026-11-03')"), 1);
    await assert.rejects(() => db.exec("select * from public.chat_order_summary('2026-01-01','2026-11-03')"), /invalid_date_range/);
    await asUser(u2);
    assert.equal(await scalar('select count(*)::int from public.chat_conversations'), 0);
    assert.equal(await scalar('select count(*)::int from public.chat_notes'), 0);
    await db.exec(`insert into public.chat_conversations(id) values ('${c2}'); insert into public.chat_notes(body) values ('private two')`);
    assert.equal(await scalar("select total::int from public.chat_order_summary('2026-11-03','2026-11-03')"), 1);
    await asUser(u1);
    await assert.rejects(() => db.exec(`update public.chat_notes set user_id = '${u2}'`), /row-level security/);
    await service();
    await assert.rejects(() => db.exec(`select public.chat_begin_turn('${u2}','${c1}','${r1}','openai','test-model','hello')`), /conversation_not_found/);
    assert.equal(await scalar(`select public.chat_begin_turn('${u1}','${c1}','${r1}','openai','test-model','hello')`), 'started');
    assert.equal(await scalar(`select public.chat_begin_turn('${u1}','${c1}','${r1}','openai','test-model','hello')`), 'running');
    await assert.rejects(() => db.exec(`select public.chat_begin_turn('${u1}','${c1}',gen_random_uuid(),'openai','test-model','parallel')`), /request_in_progress/);
    await db.exec(`select public.chat_finish_turn('${u1}','${r1}','answer')`);
    assert.equal(await scalar(`select public.chat_begin_turn('${u1}','${c1}','${r1}','openai','test-model','hello')`), 'completed');
    assert.equal(await scalar(`select count(*)::int from public.chat_messages where request_id = '${r1}'`), 2);
    await asUser(u2);
    assert.equal(await scalar('select count(*)::int from public.chat_messages'), 0);
    await asUser(u1);
    assert.equal(await scalar('select count(*)::int from public.chat_messages'), 2);
    await asUser('10000000-0000-4000-8000-000000000003');
    assert.equal(await scalar("select total::int from public.chat_order_summary('2026-11-03','2026-11-03')"), 1);
    await asUser('10000000-0000-4000-8000-000000000004');
    assert.equal(await scalar("select total::int from public.chat_order_summary('2026-11-03','2026-11-03')"), 2);
    assert.equal(await scalar('select count(*)::int from public.chat_conversations'), 0); // Admin doesn't read others' chats.
    await service();
    for (let i = 0; i < 5; i++) {
      const run = String(await scalar('select gen_random_uuid()'));
      await db.exec(`select public.chat_begin_turn('${u1}','${c1}','${run}','${i===0?'deepseek':'anthropic'}','test-model','next')`);
      await db.exec(`select public.chat_finish_turn('${u1}','${run}',null)`);
    }
    await assert.rejects(() => db.exec(`select public.chat_begin_turn('${u1}','${c1}',gen_random_uuid(),'openai','test-model','too many')`), /rate_limit/);
    await db.exec(`update public.chat_requests set created_at = now() - interval '2 minutes'`);
    const stale = String(await scalar('select gen_random_uuid()'));
    await db.exec(`select public.chat_begin_turn('${u1}','${c1}','${stale}','openai','test-model','stale');
      update public.chat_requests set expires_at = now() - interval '1 second' where id = '${stale}'`);
    await assert.rejects(() => db.exec(`select public.chat_finish_turn('${u1}','${stale}','late response')`), /request_expired/);
    const recovered = String(await scalar('select gen_random_uuid()'));
    assert.equal(await scalar(`select public.chat_begin_turn('${u1}','${c1}','${recovered}','openai','test-model','recovered')`), 'started');
    assert.equal(await scalar(`select status from public.chat_requests where id = '${stale}'`), 'failed');
    await db.exec(`select public.chat_finish_turn('${u1}','${recovered}','ok')`);
    await asUser(u1);
    await db.exec(`delete from public.chat_conversations where id = '${c2}'`);
    await asUser(u2);
    assert.equal(await scalar(`select count(*)::int from public.chat_conversations where id = '${c2}'`), 1);
    await asUser(u1);
    await db.exec(`delete from public.chat_conversations where id = '${c1}'`);
    assert.equal(await scalar('select count(*)::int from public.chat_messages'), 0);
    await db.exec('reset role; set role anon');
    await assert.rejects(() => db.exec('select * from public.chat_notes'), /permission denied/);
    await assert.rejects(() => db.exec("select * from public.chat_order_summary('2026-11-03','2026-11-03')"), /permission denied/);
    await assert.rejects(() => db.exec('select * from public.chat_telegram_accounts'), /permission denied/);
    await assert.rejects(() => db.exec('select public.chat_telegram_claim_update()'), /permission denied/);
    await asUser(u1);
    await assert.rejects(() => db.exec(`select public.chat_telegram_confirm('${u1}','x')`), /permission denied/);
    await assert.rejects(() => db.exec(`select * from public.chat_service_order_summary('${u2}','2026-11-03','2026-11-03')`), /permission denied/);
    await service();
    assert.equal(await scalar(`select total::int from public.chat_service_order_summary('${u1}','2026-11-03','2026-11-03')`),1);
    assert.equal(await scalar(`select total::int from public.chat_service_order_summary('${u2}','2026-11-03','2026-11-03')`),1);
    await db.exec(`insert into public.chat_telegram_accounts(user_id,bot_id,bot_username,encrypted_token,webhook_secret_hash,link_hash,link_expires_at)
      values('${u1}',123456,'fixture_bot','encrypted-fixture','hash','challenge',now()+interval '10 minutes')`);
    await db.exec(`update public.chat_telegram_accounts set provider='deepseek',model='deepseek-fixture' where user_id='${u1}';
      insert into public.chat_credentials(user_id,provider,encrypted_key) values('${u1}','deepseek','encrypted-fixture-for-test')`);
    assert.equal(await scalar(`select provider from public.chat_telegram_accounts where user_id='${u1}'`),'deepseek');
    await assert.rejects(()=>db.exec(`update public.chat_telegram_accounts set provider='unapproved' where user_id='${u1}'`),/check constraint/);
    const hook=String(await scalar(`select webhook_id from public.chat_telegram_accounts where user_id='${u1}'`));
    assert.equal(await scalar(`select public.chat_telegram_prepare_link('${hook}','wrong',111,'name','codehash','code message')`),false);
    assert.equal(await scalar(`select public.chat_telegram_prepare_link('${hook}','challenge',111,'name','codehash','code message')`),true);
    assert.equal(await scalar(`select public.chat_telegram_prepare_link('${hook}','challenge',222,'attacker','codehash','code message')`),false);
    for(let i=0;i<5;i++) assert.equal(await scalar(`select public.chat_telegram_confirm('${u1}','wrong')`),false);
    assert.equal(await scalar(`select public.chat_telegram_confirm('${u1}','codehash')`),false);
    await db.exec(`update public.chat_telegram_accounts set confirmation_attempts=0 where user_id='${u1}'`);
    assert.equal(await scalar(`select public.chat_telegram_confirm('${u1}','codehash')`),true);
    assert.equal(await scalar(`select public.chat_telegram_confirm('${u1}','codehash')`),false);
    assert.equal(await scalar(`select telegram_id::int from public.chat_telegram_accounts where user_id='${u1}'`),111);
    await db.exec(`insert into public.chat_telegram_updates(user_id,bot_id,update_id,telegram_id,content) values('${u1}',123456,1,111,'test')`);
    await assert.rejects(()=>db.exec(`insert into public.chat_telegram_updates(user_id,bot_id,update_id,telegram_id,content) values('${u1}',123456,1,111,'duplicate')`),/unique/);
    assert.equal((await db.query('select * from public.chat_telegram_claim_update()')).rows.length,1);
    assert.equal((await db.query('select * from public.chat_telegram_claim_update()')).rows.length,0);
    await db.exec(`update public.chat_telegram_updates set lease_until=now()-interval '1 second'`);
    assert.equal((await db.query('select * from public.chat_telegram_claim_update()')).rows.length,1);
    await db.exec(`delete from public.chat_telegram_deliveries; update public.chat_telegram_accounts set reminders_enabled=true;
      insert into public.chat_notes(user_id,body,remind_at) values('${u1}','due reminder',now()-interval '1 minute')`);
    await db.exec('select public.chat_telegram_enqueue_reminders(); select public.chat_telegram_enqueue_reminders()');
    assert.equal(await scalar("select count(*)::int from public.chat_telegram_deliveries where kind='reminder'"),1);
    assert.equal((await db.query('select * from public.chat_telegram_claim_delivery()')).rows.length,1);
    assert.equal((await db.query('select * from public.chat_telegram_claim_delivery()')).rows.length,0);
    await db.exec("update public.chat_telegram_deliveries set status='sent'; select public.chat_telegram_enqueue_reminders()");
    assert.equal(await scalar("select count(*)::int from public.chat_telegram_deliveries"),1);
    await asUser(u1);
    await assert.rejects(()=>db.exec("select public.chat_find_users(null,'admin')"),/not_authorized/);
    await assert.rejects(()=>db.exec("select public.chat_user_activity()"),/not_authorized/);
    await assert.rejects(()=>db.exec("select public.chat_user_activity(null,null,null,'10000000-0000-4000-8000-000000000004')"),/not_authorized/);
    await asUser('10000000-0000-4000-8000-000000000004');
    const directory=await scalar("select public.chat_find_users('Admin','admin')") as {users:{full_name:string}[]};
    assert.equal(directory.users.length,1);assert.equal(directory.users[0].full_name,'Admin Example');
    const allActivity=await scalar("select public.chat_user_activity()") as {latest_recorded_event:{event_type:string};events:unknown[];coverage:{records_all_database_edits:boolean}};
    assert.equal(allActivity.latest_recorded_event.event_type,'assigned');
    assert.equal(allActivity.events.length,3);assert.equal(allActivity.coverage.records_all_database_edits,false);
    const day=await scalar("select public.chat_user_activity(null,'2026-11-04','2026-11-04')") as {events:unknown[]};
    assert.equal(day.events.length,1); // 03:00 UTC belongs to the prior day in Lima.
    await assert.rejects(()=>db.exec("select public.chat_user_activity(null,'2026-11-04','2026-01-01')"),/invalid_date_range/);
    await service();
    const serviceActivity=await scalar("select public.chat_user_activity(null,null,null,'10000000-0000-4000-8000-000000000004')") as {events:unknown[]};
    assert.equal(serviceActivity.events.length,3);
    await assert.rejects(()=>db.exec(`select public.chat_user_activity(null,null,null,'${u1}')`),/not_authorized/);
    await db.exec('reset role;set role anon');
    await assert.rejects(()=>db.exec('select public.chat_user_activity()'),/permission denied/);
    await service();
    await db.exec(`delete from public.chat_telegram_accounts where user_id='${u1}'`);
    assert.equal(await scalar('select count(*)::int from public.chat_telegram_updates'),0);
    assert.equal(await scalar('select count(*)::int from public.chat_telegram_deliveries'),0);
    // Export snapshots must contain every allowed row, beyond the chat's 50-row sample.
    await db.exec(`reset role;insert into public.orders(id,status,scheduled_date,company_id,assigned_courier,order_number)
      select gen_random_uuid(),'pending','2026-11-04','20000000-0000-4000-8000-000000000001',
        case when n<=40 then '10000000-0000-4000-8000-000000000003'::uuid else null end,n from generate_series(1,80)n`);
    await asUser(u1);
    const snapshot=await scalar("select public.chat_report_data('orders','2026-11-04','2026-11-04')") as {rows:unknown[];source_ids:string[];scope:Record<string,unknown>;total_service_amount:number};
    assert.equal(snapshot.rows.length,80);assert.equal(snapshot.total_service_amount,840);
    await assert.rejects(()=>db.exec("select public.chat_report_data('activity')"),/not_authorized/);
    await assert.rejects(()=>db.exec("select public.chat_report_data('orders','2026-11-04','2026-11-04',null,null,'10000000-0000-4000-8000-000000000004')"),/not_authorized/);
    await asUser(u2);
    assert.equal(((await scalar("select public.chat_report_data('orders','2026-11-04','2026-11-04')")) as {rows:unknown[]}).rows.length,0);
    await asUser('10000000-0000-4000-8000-000000000003');
    assert.equal(((await scalar("select public.chat_report_data('orders','2026-11-04','2026-11-04')")) as {rows:unknown[]}).rows.length,40);
    await asUser(u1);
    const reportConversation=String(await scalar("insert into public.chat_conversations(title) values('Report fixture') returning id"));
    await service();
    const reportRequest=String(await scalar('select gen_random_uuid()'));
    await db.exec(`select public.chat_begin_turn('${u1}','${reportConversation}','${reportRequest}','openai','fixture','report')`);
    const reportId=String(await scalar('select gen_random_uuid()'));
    await db.query(`insert into public.chat_reports(id,user_id,conversation_id,request_id,dataset,format,fingerprint,filename,storage_path,status,row_count,byte_size,access_scope,source_ids)
      values($1,$2,$3,$4,'orders','xlsx','fixture','report.xlsx','fixture/report.xlsx','ready',80,1024,$5,$6)`,
      [reportId,u1,reportConversation,reportRequest,JSON.stringify(snapshot.scope),snapshot.source_ids]);
    await asUser(u1);
    assert.ok(await scalar(`select public.chat_authorize_report('${reportId}')`));
    await asUser(u2);
    assert.equal(await scalar(`select public.chat_authorize_report('${reportId}')`),null);
    await assert.rejects(()=>db.exec(`select public.chat_authorize_report('${reportId}','${u1}')`),/not_authorized/);
    await service();
    await db.exec(`update public.profiles set company_id='20000000-0000-4000-8000-000000000002' where id='${u1}'`);
    await asUser(u1);assert.equal(await scalar(`select public.chat_authorize_report('${reportId}')`),null);
    await service();
    await db.exec(`update public.profiles set company_id='20000000-0000-4000-8000-000000000001' where id='${u1}';
      update public.chat_reports set expires_at=now()-interval '1 second' where id='${reportId}'`);
    await asUser(u1);assert.equal(await scalar(`select public.chat_authorize_report('${reportId}')`),null);
    await service();
    await db.exec(`update public.chat_reports set expires_at=now()+interval '1 day' where id='${reportId}'`);
    await db.exec(`insert into public.chat_usage_calls(user_id,conversation_id,request_id,turn_id,step,provider,model,channel)
      values('${u1}','${reportConversation}','${reportRequest}','${reportRequest}',0,'openrouter','fixture/chat','web')`);
    await asUser(u1);await db.exec(`delete from public.chat_conversations where id='${reportConversation}'`);
    await service();
    assert.equal(await scalar(`select conversation_id from public.chat_reports where id='${reportId}'`),null);
    assert.equal(await scalar(`select request_id from public.chat_reports where id='${reportId}'`),null);
    assert.equal(await scalar(`select count(*)::int from public.chat_usage_calls where turn_id='${reportRequest}' and request_id is null and conversation_id is null`),1);
    await db.exec(`delete from public.chat_usage_calls where turn_id='${reportRequest}'`);
    await db.exec('reset role;set role anon');
    await assert.rejects(()=>db.exec("select public.chat_report_data('notes')"),/permission denied/);
    await assert.rejects(()=>db.exec("select public.chat_usage_summary('2026-11-04','2026-11-04')"),/permission denied/);
    await service();
    await db.exec(`insert into public.chat_usage_calls(user_id,turn_id,step,provider,model,channel,state,input_tokens,output_tokens,cost_kind,cost_usd,created_at)
      values('${u1}','${r1}',0,'openrouter','fixture/chat','web','received',100,20,'reported',0.01,'2026-11-04 05:30:00+00'),
      ('${u1}','${r1}',1,'openrouter','fixture/chat','telegram','received',200,30,'reported',0.02,'2026-11-04 06:30:00+00'),
      ('${u1}',gen_random_uuid(),0,'anthropic','fixture-unpriced','web','unconfirmed',null,null,'unknown',null,'2026-11-04 07:30:00+00'),
      ('${u2}',gen_random_uuid(),0,'openrouter','other-secret-model','web','received',999,99,'reported',100,'2026-11-04 07:30:00+00'),
      ('${u1}',gen_random_uuid(),0,'deepseek','prior-lima-date','web','received',777,77,'unknown',null,'2026-11-04 04:00:00+00')`);
    await assert.rejects(()=>db.exec(`insert into public.chat_usage_calls(user_id,turn_id,step,provider,model,channel) values('${u1}','${r1}',0,'openrouter','fixture','web')`),/unique/);
    await asUser(u1);
    await assert.rejects(()=>db.exec('update public.chat_usage_calls set cost_usd=0'),/permission denied/);
    await assert.rejects(()=>db.exec('select * from public.chat_model_prices'),/permission denied/);
    const consumption=await scalar("select public.chat_usage_summary('2026-11-04','2026-11-04')") as {totals:{calls:number;queries:number;input_tokens:number;reported_usd:number;unpriced_calls:number};models:unknown[]};
    assert.equal(consumption.totals.calls,3);assert.equal(consumption.totals.queries,2);assert.equal(consumption.totals.input_tokens,300);assert.equal(consumption.totals.reported_usd,0.03);assert.equal(consumption.totals.unpriced_calls,1);
    assert.ok(!JSON.stringify(consumption).includes('other-secret-model'));assert.ok(!JSON.stringify(consumption).includes('prior-lima-date'));
    assert.equal(((await scalar("select public.chat_usage_summary('2026-11-04','2026-11-04','openrouter')")) as typeof consumption).totals.calls,2);
    await assert.rejects(()=>db.exec("select public.chat_usage_summary('2026-11-04','2026-11-04',null,null,'10000000-0000-4000-8000-000000000002')"));
    await assert.rejects(()=>db.exec("select public.chat_usage_summary('2025-01-01','2026-11-04')"),/invalid_date_range/);
    await asUser('10000000-0000-4000-8000-000000000004');
    assert.equal(((await scalar("select public.chat_usage_summary('2026-11-04','2026-11-04')")) as typeof consumption).totals.calls,0);
  } finally { await db.close(); }
});
