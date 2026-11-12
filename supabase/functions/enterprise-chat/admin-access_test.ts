import assert from 'node:assert/strict';
import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {createHandler} from './handler.ts';
import {dispatchTelegramDeliveries,processTelegramUpdate} from './telegram-worker.ts';
const id='10000000-0000-4000-8000-000000000001';
const job='20000000-0000-4000-8000-000000000001';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

Deno.test('Only admins can use chat actions, even with spoofed admin metadata',async()=>{
 const original=globalThis.fetch;let currentRole='client';let requests=0;
 const handler=createHandler({url:'http://localhost:54321',anonKey:'fixture-public',serviceKey:'fixture-service',encryptionKey:'',origins:[]});
 globalThis.fetch=(async(input,init)=>{
  const req=input instanceof Request?input:new Request(input,init);const path=new URL(req.url).pathname;requests++;
  if(path==='/auth/v1/user')return json({id,is_anonymous:false,app_metadata:{role:'admin'},user_metadata:{role:'admin'}});
  if(path==='/rest/v1/profiles')return json({id,role:currentRole,company_id:job});
  throw new Error('Denied roles must not access credentials, data, or providers');
 }) as typeof fetch;
 try{
  for(const role of ['staff','courier','client']){
   currentRole=role;
   for(const action of ['bootstrap','due_notes','save_key','models','send','create_conversation','save_note','usage_summary','download_report','telegram_connect']){
    const response=await handler(new Request('http://local',{method:'POST',headers:{Authorization:'Bearer fixture-session','Content-Type':'application/json'},body:JSON.stringify({action})}));
    assert.equal(response.status,403,`${role}/${action}`);assert.match((await response.json()).error,/administradores/);
   }
  }
  assert.equal(requests,60);
 }finally{globalThis.fetch=original;}
});

for(const role of ['staff','courier','client'])Deno.test(`Telegram skips ${role} deliveries and rejects queries before calling a provider`,async()=>{
 const original=globalThis.fetch;let claimed=false;let deliveryState='';let queryState='';
 const account={user_id:id,bot_id:123,telegram_id:456,blocked:false};
 globalThis.fetch=(async(input,init)=>{
  const req=input instanceof Request?input:new Request(input,init);const path=new URL(req.url).pathname;
  assert.equal(new URL(req.url).hostname,'localhost');
  if(path.endsWith('chat_telegram_claim_delivery')){if(claimed)return json([]);claimed=true;return json([{id:job,user_id:id,bot_id:123,telegram_id:456,kind:'reply'}]);}
  if(path.endsWith('chat_telegram_claim_update'))return json([{id:job,user_id:id,bot_id:123,telegram_id:456,content:'Consulta pedidos'}]);
  if(path.endsWith('chat_telegram_accounts'))return json(account);
  if(path.includes('/auth/v1/admin/users/'))return json({user:{id,is_anonymous:false,app_metadata:{}}});
  if(path.endsWith('profiles'))return json({id,role,company_id:job});
  if(path.endsWith('chat_telegram_deliveries')){deliveryState=(await req.json()).status;return json(null);}
  if(path.endsWith('chat_telegram_updates')){queryState=(await req.json()).status;return json(null);}
  throw new Error(`Unexpected call for blocked role: ${path}`);
 }) as typeof fetch;
 try{
  const client=createClient('http://localhost:54321','fixture-service',{auth:{persistSession:false}});
  await dispatchTelegramDeliveries(client,'',1);assert.equal(deliveryState,'skipped');
  await processTelegramUpdate(client,'');assert.equal(queryState,'failed');
 }finally{globalThis.fetch=original;}
});
