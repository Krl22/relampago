import assert from 'node:assert/strict';
import {connect} from '../../scripts/lib/db.mjs';
const sql=await connect();let checks=0;
try{await sql.begin(async tx=>{
 await tx.unsafe('set transaction read only');
 const[admin]=await tx`select id from public.profiles where role='admin' limit 1`;
 const couriers=await tx`select id from public.profiles where role='courier' order by created_at limit 2`;
 const[client]=await tx`select id from public.profiles where role='client' limit 1`;
 assert.ok(admin&&client&&couriers.length>=1,'Existing admin, client and a courier required');
 const target=couriers.at(-1).id;
 const scopes=[['profiles','id'],['orders','assigned_courier'],['pickup_assignments','courier_id'],['courier_locations','courier_id']];
 const expected={};for(const[table,column]of scopes)expected[table]=(await tx.unsafe(`select count(*)::int as n from public.${table} where ${column}=$1`,[target]))[0].n;
 const eventCount=(await tx`select count(*)::int as n from public.order_events where actor_id=${target} or courier_id=${target}`)[0].n;
 const asActor=async(id,fn)=>{await tx`select set_config('request.jwt.claim.sub',${id},true),set_config('request.jwt.claims',${JSON.stringify({sub:id,role:'authenticated'})},true)`;await tx.unsafe('set local role authenticated');await fn();await tx.unsafe('reset role');};
 await asActor(admin.id,async()=>{for(const[table,column]of scopes){assert.equal((await tx.unsafe(`select count(*)::int as n from public.${table} where ${column}=$1`,[target]))[0].n,expected[table]);checks++;}assert.equal((await tx`select count(*)::int as n from public.order_events where actor_id=${target} or courier_id=${target}`)[0].n,eventCount);checks++;assert.equal((await tx`select auth.uid() as id`)[0].id,admin.id);checks++;assert.equal((await tx`select count(*)::int as n from public.profiles where id=${admin.id} and role='courier'`)[0].n,0);checks++;});
 await asActor(target,async()=>{for(const[table,column]of scopes){assert.equal((await tx.unsafe(`select count(*)::int as n from public.${table} where ${column}=$1`,[target]))[0].n,expected[table]);checks++;}assert.equal((await tx`select count(*)::int as n from public.profiles where id=${admin.id}`)[0].n,0);checks++;});
 const deniedActors=couriers.length>1?[couriers[0].id,client.id]:[client.id];
 for(const actor of deniedActors)await asActor(actor,async()=>{for(const[table,column]of scopes){if(table==='orders'&&actor===client.id)continue;assert.equal((await tx.unsafe(`select count(*)::int as n from public.${table} where ${column}=$1`,[target]))[0].n,0,`${table} isolation`);checks++;}});
 });console.log(JSON.stringify({passed:checks,transaction:'read only',admin_identity_preserved:true,courier_own_scope:true,client_gps_and_profile_isolated:true,schema_changes:0},null,2));}finally{await sql.end();}
