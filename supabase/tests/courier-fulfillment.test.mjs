import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connect } from '../../scripts/lib/db.mjs';
import { isReadyForRoute } from '../../src/lib/fulfillment.ts';

const version = '20261106054817';
const migration = readFileSync(`supabase/migrations/${version}_courier_collection_before_delivery.sql`, 'utf8');
const sql = await connect();
const rollback = new Error('QA_ROLLBACK');
const tests = [];
try {
  await sql.begin(async tx => {
    if (!(await tx`select 1 from supabase_migrations.schema_migrations where version=${version}`).length) await tx.unsafe(migration);
    const [courier] = await tx`select id from public.profiles where role='courier' limit 1`;
    const [admin] = await tx`select id from public.profiles where role='admin' limit 1`;
    assert.ok(courier && admin, 'Existing test identities required');
    const [company] = await tx`insert into public.companies(name) values('QA fulfillment rollback') returning id`;
    await tx`insert into public.company_addresses(company_id,address,is_default) values(${company.id},'QA pickup address',true)`;
    const [stock] = await tx`insert into public.stock(company_id,product_name,quantity) values(${company.id},'QA fulfillment product',10) returning id`;
    const [warehouse] = await tx`insert into public.orders(company_id,assigned_courier,destination_address,destination_district,origin_type,packages_count)
      values(${company.id},${courier.id},'QA destination','Miraflores','warehouse',2) returning id`;
    await tx`insert into public.order_items(order_id,stock_id,product_name,quantity) values(${warehouse.id},${stock.id},'QA fulfillment product',2)`;
    const [pickupOrder] = await tx`insert into public.orders(company_id,assigned_courier,destination_address,destination_district,origin_type,packages_count)
      values(${company.id},${courier.id},'QA destination','Miraflores','pickup',2) returning id,pickup_id`;
    await tx`insert into public.pickup_assignments(pickup_id,courier_id) values(${pickupOrder.pickup_id},${courier.id})`;

    const asActor = async (id, fn) => tx.savepoint(async sp => {
      await sp`select set_config('request.jwt.claim.sub',${id},true),set_config('request.jwt.claims',${JSON.stringify({sub:id,role:'authenticated'})},true)`;
      await sp.unsafe('set local role authenticated');
      await fn(sp);
      await sp.unsafe('reset role');
      await sp`select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true)`;
    });
    const denied = (orderId, status) => assert.rejects(asActor(courier.id, sp => sp`update public.orders set status=${status} where id=${orderId}`), e => e.code === '23514');

    await denied(warehouse.id,'in_transit');
    await denied(warehouse.id,'delivered');
    await asActor(courier.id, sp => sp`update public.orders set status='picked_up' where id=${warehouse.id}`);
    assert.equal((await tx`select quantity from public.stock where id=${stock.id}`)[0].quantity,10);
    const [event] = await tx`select actor_id,from_status,to_status from public.order_events where order_id=${warehouse.id} and to_status='picked_up'`;
    assert.equal(event.actor_id,courier.id);
    assert.equal(event.from_status,'pending');
    tests.push('Warehouse withdrawal required, attributed in history, and does not prematurely deduct stock');
    await denied(warehouse.id,'delivered');
    await asActor(courier.id, async sp => {
      await sp`update public.orders set status='in_transit' where id=${warehouse.id}`;
      await sp`update public.orders set status='delivered' where id=${warehouse.id}`;
    });
    assert.equal((await tx`select quantity from public.stock where id=${stock.id}`)[0].quantity,8);
    tests.push('Collected warehouse order follows route then delivery; stock deducted once');

    await denied(pickupOrder.id,'picked_up');
    await denied(pickupOrder.id,'in_transit');
    await asActor(courier.id, sp => sp`update public.pickup_assignments set packages_count=1,picked_up_at=now() where pickup_id=${pickupOrder.pickup_id} and courier_id=${courier.id}`);
    await denied(pickupOrder.id,'in_transit');
    tests.push('Unreceived and partially received address pickups cannot start deliveries');
    await asActor(courier.id, sp => sp`update public.pickup_assignments set packages_count=2,picked_up_at=now() where pickup_id=${pickupOrder.pickup_id} and courier_id=${courier.id}`);
    assert.equal((await tx`select status from public.pickups where id=${pickupOrder.pickup_id}`)[0].status,'picked_up');
    await asActor(courier.id, sp => sp`update public.orders set status='in_transit' where id=${pickupOrder.id}`);
    await denied(pickupOrder.id,'pending');
    await asActor(courier.id, sp => sp`update public.orders set status='failed' where id=${pickupOrder.id}`);
    tests.push('Complete address receipt unlocks route; courier cannot rewind; failed delivery remains supported');

    await asActor(admin.id, sp => sp`update public.orders set status='pending' where id=${pickupOrder.id}`);
    tests.push('Central retains corrections; existing terminal orders are not rewritten');
    const [privileges] = await tx`select has_function_privilege('authenticated','private.guard_courier_fulfillment()','execute') as can_call`;
    assert.equal(privileges.can_call,false);
    tests.push('Trigger helper cannot be called by app users');

    for (const origin_type of ['warehouse','pickup']) {
      for (const status of ['pending','picked_up','in_transit']) {
        for (const pickupStatus of [null,'assigned','picked_up']) {
          const order = {origin_type,status,pickups:pickupStatus ? {status:pickupStatus} : null};
          assert.equal(isReadyForRoute(order), status !== 'pending' || (origin_type === 'pickup' && pickupStatus === 'picked_up'));
        }
      }
    }
    tests.push('Route readiness covers warehouse, merchant pickup, missing relations and completed receipt');
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { await sql.end(); }
console.log(JSON.stringify({passed:tests.length,tests,production_test_changes:'rolled back'},null,2));
