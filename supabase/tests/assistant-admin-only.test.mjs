import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connect} from '../../scripts/lib/db.mjs';
const version='20261106041038';
const migration=readFileSync(`supabase/migrations/${version}_assistant_admin_only.sql`,'utf8');
const sql=await connect();const rollback=new Error('QA_ROLLBACK');let checks=0;
try{
 await sql.begin(async tx=>{
  if(!(await tx`select version from supabase_migrations.schema_migrations where version=${version}`).length)await tx.unsafe(migration);
  const [admin]=await tx`select id from public.profiles where role='admin' limit 1`;
  const [other]=await tx`select id from public.profiles where role='client' limit 1`;
  const [ownNote]=await tx`insert into public.chat_notes(user_id,body) values(${admin.id},'QA admin-only rollback') returning id`;
  const [otherNote]=await tx`insert into public.chat_notes(user_id,body) values(${other.id},'QA nonadmin rollback') returning id`;
  const auth=async(id)=>{
   await tx`select set_config('request.jwt.claim.sub',${id},true)`;
   await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:id,role:'authenticated'})},true)`;
   await tx`set local role authenticated`;
  };
  for(const role of ['client','courier','staff']){
   await tx`update public.profiles set role=${role} where id=${other.id}`;
   await auth(other.id);
   assert.equal((await tx`select count(*)::int as n from public.chat_notes where id=${otherNote.id}`)[0].n,0);checks++;
   await assert.rejects(tx.savepoint(async sp=>{await sp`insert into public.chat_conversations(user_id) values(${other.id})`;}),e=>e.code==='42501');checks++;
   await assert.rejects(tx.savepoint(async sp=>{await sp`select public.chat_order_summary(current_date-1,current_date)`;}),e=>e.code==='42501');checks++;
   await assert.rejects(tx.savepoint(async sp=>{await sp`select public.chat_usage_summary(current_date-1,current_date)`;}),e=>e.code==='42501');checks++;
   await assert.rejects(tx.savepoint(async sp=>{await sp`select public.chat_report_data('notes',p_viewer_id=>${admin.id})`;}),e=>e.code==='42501');checks++;
   await assert.rejects(tx.savepoint(async sp=>{await sp`select public.chat_authorize_report(${ownNote.id})`;}),e=>e.code==='42501');checks++;
   await tx`reset role`;
  }
  await auth(admin.id);
  assert.equal((await tx`select count(*)::int as n from public.chat_notes where id=${ownNote.id}`)[0].n,1);checks++;
  assert.equal((await tx`select count(*)::int as n from public.chat_notes where id=${otherNote.id}`)[0].n,0);checks++;
  await tx`select public.chat_order_summary(current_date-1,current_date)`;checks++;
  await tx`select public.chat_usage_summary(current_date-1,current_date)`;checks++;
  await tx`reset role`;
  await tx`set local role service_role`;
  await assert.rejects(tx.savepoint(async sp=>{await sp`select public.chat_report_data('notes',p_viewer_id=>${other.id})`;}),e=>e.code==='42501');checks++;
  await tx`select public.chat_report_data('notes',p_viewer_id=>${admin.id})`;checks++;
  await tx`reset role`;
  throw rollback;
 });
}catch(error){if(error!==rollback)throw error;}
finally{await sql.end();}
console.log(JSON.stringify({passed:checks,checks:'Admin access, owner isolation, denied staff/courier/client RLS and direct RPC access, service report authorization',test_changes:'rolled back'}));
