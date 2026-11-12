import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { encryptKey } from "./crypto.ts";
import { requestSchema } from "./validation.ts";
import { sha256,splitTelegramText,telegramApi,TelegramError } from "./telegram-api.ts";
import { createTelegramWebhook } from "./telegram-webhook.ts";
import { createTelegramWorker,dispatchTelegramDeliveries } from "./telegram-worker.ts";
import { telegramSettings } from "./telegram-settings.ts";

// Synthetic fixtures only; every fetch is intercepted, never sent to Telegram.
const token="123456789:"+"fixture_not_a_real_token_".repeat(2);
const master=btoa(String.fromCharCode(...new Uint8Array(32).fill(4)));
const userId="10000000-0000-4000-8000-000000000001";
const hook="20000000-0000-4000-8000-000000000001";
const secret="synthetic-webhook-secret";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const client=()=>createClient("http://localhost:54321","test-service-fixture",{auth:{persistSession:false,autoRefreshToken:false}});
const account=async()=>({user_id:userId,bot_id:123456789,bot_username:"fixture_bot",encrypted_token:await encryptKey(token,userId,"telegram",master),
  webhook_id:hook,webhook_secret_hash:await sha256(secret),link_hash:await sha256("a".repeat(64)),link_expires_at:new Date(Date.now()+600000).toISOString(),
  pending_telegram_id:null,telegram_id:111,linked_at:new Date(Date.now()-30000).toISOString(),model:"test-model",provider:"openai",conversation_id:null,blocked:false,reminders_enabled:true});
const incoming=(text="hola",sender=111,chatType="private")=>({update_id:1,message:{message_id:1,date:Math.floor(Date.now()/1000),
  from:{id:sender,is_bot:false,first_name:"Fixture"},chat:{id:sender,type:chatType},text}});

Deno.test("Telegram validation and Unicode-safe splitting keep secrets/unsupported inputs out of chat actions",()=>{
  assert.equal(requestSchema.safeParse({action:"telegram_connect",token:"https://evil.invalid"}).success,false);
  assert.equal(requestSchema.safeParse({action:"telegram_confirm",code:"12345"}).success,false);
  assert.equal(requestSchema.safeParse({action:"telegram_confirm",code:"123456",user_id:userId}).success,false);
  const input="🛵".repeat(5000);
  const parts=splitTelegramText(input);
  assert.equal(parts.join(""),input);
  assert.ok(parts.every(part=>part.length<=3500&&!/[\uD800-\uDBFF]$/.test(part)));
});

Deno.test("Telegram webhook requires correct secret and private linked identity; duplicate updates use durable conflict protection",async()=>{
  const original=globalThis.fetch; const a=await account();let inserts=0,kicks=0;
  globalThis.fetch=(async(input,init)=>{
    const req=input instanceof Request?input:new Request(input,init);const url=new URL(req.url);
    assert.equal(url.hostname,"localhost");
    if(url.pathname.endsWith("chat_telegram_accounts"))return req.method==='GET'?json(a):json(null);
    if(url.pathname.endsWith('chat_telegram_deliveries'))return json(null,201);
    if(req.method==="HEAD")return new Response(null,{headers:{"Content-Range":"*/0"}});
    if(url.pathname.endsWith("chat_telegram_updates")){
      const body=await req.json();assert.equal(body.user_id,userId);assert.equal(body.telegram_id,111);
      assert.ok(req.headers.get("Prefer")?.includes("ignore-duplicates"));inserts++;return json(null,201);
    }
    throw new Error("Unexpected network call");
  }) as typeof fetch;
  const handler=createTelegramWebhook(client(),()=>{kicks++});
  const call=(body:unknown,header=secret)=>handler(new Request(`http://local/telegram-webhook/${hook}`,{method:"POST",
    headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":header},body:JSON.stringify(body)}));
  try{
    assert.equal((await call(incoming(),"wrong")).status,401);
    assert.equal((await call(incoming("hi",222))).status,200);
    assert.equal((await call(incoming("hi",111,"group"))).status,200);
    assert.equal(inserts,0);
    assert.equal((await call(incoming())).status,200);
    assert.equal((await call(incoming())).status,200);
    assert.equal(inserts,2);assert.equal(kicks,3); // One generic setup reply plus the two deduplicated message deliveries.
  }finally{globalThis.fetch=original}
});

Deno.test("Telegram linking issues a hashed challenge; webhook never binds the account without web confirmation",async()=>{
  const original=globalThis.fetch;const a=await account();let prepared=false;
  globalThis.fetch=(async(input,init)=>{
    const req=input instanceof Request?input:new Request(input,init);const url=new URL(req.url);
    if(url.pathname.endsWith("chat_telegram_accounts")) {
      if(req.method==='GET')return json(a);
      assert.deepEqual(Object.keys(await req.json()).sort(),['last_webhook_at','last_webhook_state']);return json(null);
    }
    if(url.pathname.endsWith("chat_telegram_prepare_link")){
      const body=await req.json();assert.equal(body.p_telegram_id,111);assert.equal(body.p_link_hash,a.link_hash);
      assert.ok(/^[0-9a-f]{64}$/.test(body.p_confirmation_hash));assert.match(body.p_body,/\d{6}/);prepared=true;return json(true);
    }
    throw new Error("Unexpected account mutation");
  }) as typeof fetch;
  try{
    const handler=createTelegramWebhook(client(),()=>{});
    const response=await handler(new Request(`http://local/telegram-webhook/${hook}`,{method:"POST",
      headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":secret},body:JSON.stringify(incoming("/start "+"a".repeat(64)))}));
    assert.equal(response.status,200);assert.equal(prepared,true);
  }finally{globalThis.fetch=original}
});

Deno.test('An unlinked /start gets setup guidance, not silence or an unverified binding/code',async()=>{
  const original=globalThis.fetch;const a={...await account(),telegram_id:null};let notice=false;let state='';
  globalThis.fetch=(async(input,init)=>{
    const req=input instanceof Request?input:new Request(input,init);const url=new URL(req.url);
    if(url.pathname.endsWith('chat_telegram_accounts')){
      if(req.method==='GET')return json(a);
      state=(await req.json()).last_webhook_state;return json(null);
    }
    if(url.pathname.endsWith('chat_telegram_deliveries')){
      const value=await req.json();assert.equal(value.kind,'notice');assert.equal(value.telegram_id,111);
      assert.ok(value.body.includes('/start solo no vincula'));
      assert.equal(value.body.includes(a.link_hash),false);notice=true;return json(null,201);
    }
    throw new Error('Plain /start must not prepare a confirmation challenge');
  }) as typeof fetch;
  try{
    const response=await createTelegramWebhook(client(),()=>{})(new Request(`http://local/telegram-webhook/${hook}`,{method:'POST',
      headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(incoming('/start'))}));
    assert.equal(response.status,200);assert.equal(notice,true);assert.equal(state,'start_without_link');
  }finally{globalThis.fetch=original;}
});

Deno.test("Telegram status never returns credentials, webhook secrets or challenges",async()=>{
  const original=globalThis.fetch;const a=await account();
  globalThis.fetch=(async()=>json({...a,pending_name:"Fixture",confirmation_hash:"sensitive-fixture",last_delivery_error:null})) as typeof fetch;
  try{
    const result=await telegramSettings(client(),userId,master,"http://local",{action:"telegram_status"},true);
    const serialized=JSON.stringify(result);
    for(const forbidden of ["encrypted_token","webhook_secret_hash","confirmation_hash","link_hash",token,"sensitive-fixture"]) assert.equal(serialized.includes(forbidden),false);
  }finally{globalThis.fetch=original}
});

Deno.test("Telegram outbox: successful/429/uncertain/cancelled deliveries are handled without blind retries",async()=>{
  const original=globalThis.fetch;const a=await account();
  try{
    for(const scenario of ["success","429","uncertain","cancelled"]){
      let claimed=false,sends=0;const statuses:string[]=[];
      globalThis.fetch=(async(input,init)=>{
        const req=input instanceof Request?input:new Request(input,init);const url=new URL(req.url);
        if(url.hostname==="api.telegram.org"){
          sends++;assert.equal(req.redirect,"error");
          if(scenario==="uncertain")throw new TypeError("Fixture timeout with private URL");
          return scenario==="429"?json({ok:false,error_code:429,parameters:{retry_after:15}},429):json({ok:true,result:{message_id:42}});
        }
        assert.equal(url.hostname,"localhost");
        if(url.pathname.endsWith("chat_telegram_claim_delivery")){
          if(claimed)return json([]);claimed=true;
          return json([{id:hook,user_id:userId,bot_id:a.bot_id,telegram_id:111,kind:"reminder",source_id:hook,note_id:hook,body:"Reminder fixture",attempts:1}]);
        }
        if(url.pathname.endsWith("chat_telegram_accounts"))return req.method==="GET"?json(a):json(null);
        if(url.pathname.includes("/auth/v1/admin/users/"))return json({user:{id:userId,app_metadata:{},is_anonymous:false}});
        if(url.pathname.endsWith("profiles"))return json({id:userId,role:"admin",company_id:null});
        if(url.pathname.endsWith("chat_notes"))return json({completed:scenario==="cancelled",remind_at:new Date(Date.now()-10000).toISOString()});
        if(url.pathname.endsWith("chat_telegram_deliveries")){statuses.push((await req.json()).status);return json(null)}
        throw new Error("Unexpected fixture request");
      }) as typeof fetch;
      await dispatchTelegramDeliveries(client(),master,2);
      assert.equal(sends,scenario==="cancelled"?0:1);
      assert.equal(statuses[0],{success:"sent","429":"pending",uncertain:"uncertain",cancelled:"skipped"}[scenario]);
    }
  }finally{globalThis.fetch=original}
});

Deno.test("Telegram worker rejects unauthenticated cron calls without accessing the database",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(()=>{throw new Error("Must not access network")}) as typeof fetch;
  try{
    const handler=createTelegramWorker(client(),master,"private-scheduler-fixture");
    assert.equal((await handler(new Request("http://local",{method:"POST"}))).status,401);
    assert.equal((await handler(new Request("http://local",{method:"GET"}))).status,405);
  }finally{globalThis.fetch=original}
});

Deno.test("Telegram API errors never expose the bot token or remote error body",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>json({ok:false,error_code:401,description:token},401)) as typeof fetch;
  try{await assert.rejects(()=>telegramApi(token,"getMe"),error=>error instanceof TelegramError&&!error.message.includes(token))}
  finally{globalThis.fetch=original}
});
