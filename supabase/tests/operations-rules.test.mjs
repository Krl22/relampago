import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connect } from '../../scripts/lib/db.mjs';

const migration=readFileSync('supabase/migrations/20261106034917_stock_priority_and_courier_accounts.sql','utf8');
const sql=await connect();
const rollback=new Error('QA_ROLLBACK');
const tests=[];
try {
 await sql.begin(async tx=>{
  const applied=await tx`select version from supabase_migrations.schema_migrations where version='20261106034917'`;
  if(!applied.length) await tx.unsafe(migration);
  const [a]=await tx`insert into public.companies(name) values('QA priority rollback A') returning id,skip_cutoff`;
  const [b]=await tx`insert into public.companies(name) values('QA priority rollback B') returning id`;
  assert.equal(a.skip_cutoff,false);
  const [item]=await tx`insert into public.stock(company_id,product_name,quantity) values(${a.id},'QA empty inventory',0) returning id`;
  assert.equal((await tx`select skip_cutoff from public.companies where id=${a.id}`)[0].skip_cutoff,true);
  await tx`update public.companies set skip_cutoff=false where id=${a.id}`;
  assert.equal((await tx`select skip_cutoff from public.companies where id=${a.id}`)[0].skip_cutoff,true);
  tests.push('Stock registration, including zero quantity, activates priority; manual override cannot disable it');
  await tx`update public.stock set company_id=${b.id} where id=${item.id}`;
  const moved=await tx`select id,skip_cutoff from public.companies where id in(${a.id},${b.id})`;
  assert.equal(moved.find(c=>c.id===a.id).skip_cutoff,false);assert.equal(moved.find(c=>c.id===b.id).skip_cutoff,true);
  await tx`delete from public.stock where id=${item.id}`;
  assert.equal((await tx`select skip_cutoff from public.companies where id=${b.id}`)[0].skip_cutoff,false);
  tests.push('Moving inventory refreshes both commerces; deleting the last SKU removes priority');
  const [admin]=await tx`select id from public.profiles where role='admin' limit 1`;
  const [courier]=await tx`select id from public.profiles where role='courier' limit 1`;
  await tx`update public.profiles set is_courier=true where id=${admin.id}`;
  assert.equal((await tx`select is_courier from public.profiles where id=${admin.id}`)[0].is_courier,false);
  await tx`update public.profiles set is_courier=false where id=${courier.id}`;
  assert.equal((await tx`select is_courier from public.profiles where id=${courier.id}`)[0].is_courier,true);
  tests.push('Only courier roles can retain the courier flag');
  const [order]=await tx`select id from public.orders limit 1`;
  await assert.rejects(tx.savepoint(async sp=>{await sp`update public.orders set assigned_courier=${admin.id} where id=${order.id}`;}),e=>e.code==='23514');
  await tx`update public.orders set assigned_courier=${courier.id} where id=${order.id}`;
  tests.push('Order assignment rejects administrators and accepts courier accounts');
  const [pickup]=await tx`select id from public.pickups limit 1`;
  await assert.rejects(tx.savepoint(async sp=>{await sp`insert into public.pickup_assignments(pickup_id,courier_id) values(${pickup.id},${admin.id})`;}),e=>e.code==='23514');
  await assert.rejects(tx.savepoint(async sp=>{await sp`insert into public.courier_locations(courier_id,lat,lng) values(${admin.id},-12,-77)`;}),e=>e.code==='23514');
  tests.push('Pickup assignments and location updates reject administrator accounts');
  const [privileges]=await tx`select has_function_privilege('authenticated','private.require_courier_account()','execute') as can_call`;
  assert.equal(privileges.can_call,false);
  const [bad]=await tx`select count(*)::int as n from public.companies c where c.skip_cutoff is distinct from exists(select 1 from public.stock s where s.company_id=c.id)`;
  assert.equal(bad.n,0);
  tests.push('Trigger helpers are not callable by app users; all priorities match registered inventory');
  throw rollback;
 });
}catch(error){if(error!==rollback)throw error;}
finally{await sql.end();}
console.log(JSON.stringify({passed:tests.length,tests,production_test_changes:'rolled back'},null,2));
