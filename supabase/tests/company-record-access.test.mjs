import assert from 'node:assert/strict';
import {connect} from '../../scripts/lib/db.mjs';
const sql=await connect();let checks=0;
try{
 await sql.begin(async tx=>{
  await tx.unsafe('set transaction read only');
  const[admin]=await tx`select id from public.profiles where role='admin' limit 1`;
  const[client]=await tx`select id,company_id from public.profiles where role='client' and company_id is not null limit 1`;
  assert.ok(admin&&client,'Existing identities are required');
  const[other]=await tx`select id from public.companies where id<>${client.company_id} order by created_at desc nulls last limit 1`;
  assert.ok(other);
  const tables=['companies','orders','stock','stock_availability','stock_movements','pickups','settlements','company_addresses'];
  const counts={};for(const table of tables){const column=table==='companies'?'id':'company_id';counts[table]=(await tx.unsafe(`select count(*)::int as n from public.${table} where ${column}=$1`,[other.id]))[0].n;}
  const actor=async(id,check)=>{
    await tx`select set_config('request.jwt.claim.sub',${id},true),set_config('request.jwt.claims',${JSON.stringify({sub:id,role:'authenticated'})},true)`;
    await tx.unsafe('set local role authenticated');await check();await tx.unsafe('reset role');
  };
  await actor(admin.id,async()=>{for(const table of tables){const column=table==='companies'?'id':'company_id';const result=await tx.unsafe(`select count(*)::int as n from public.${table} where ${column}=$1`,[other.id]);assert.equal(result[0].n,counts[table],`admin ${table}`);checks++;}assert.equal((await tx`select auth.uid() as id`)[0].id,admin.id);checks++;});
  await actor(client.id,async()=>{for(const table of tables){const column=table==='companies'?'id':'company_id';const result=await tx.unsafe(`select count(*)::int as n from public.${table} where ${column}=$1`,[other.id]);assert.equal(result[0].n,0,`client isolation ${table}`);checks++;}});
  const[view]=await tx`select reloptions from pg_class where oid='public.stock_availability'::regclass`;assert.ok(view.reloptions.includes('security_invoker=true'));checks++;
  const constraints=await tx`select conname from pg_constraint where conname in('orders_assigned_courier_fkey','order_events_actor_id_fkey')`;
  assert.equal(constraints.length,2);checks++;
 });
 console.log(JSON.stringify({passed:checks,transaction:'read only',admin_session_preserved:true,client_isolation:true,schema_changes:0},null,2));
}finally{await sql.end();}
