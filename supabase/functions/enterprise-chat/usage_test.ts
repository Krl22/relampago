import assert from 'node:assert/strict';
import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {extractUsage,createUsageRecorder,type Price} from './usage.ts';
import {openrouter,openai,type Generation} from './providers.ts';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const price:Price={input_per_million:2,output_per_million:10,cached_per_million:0.1,write_short_per_million:2.5,write_long_per_million:4,max_input_tokens:100000,source_url:'https://example.invalid/fixture',price_note:'Fixture tariff',verified_at:new Date().toISOString(),valid_until:new Date(Date.now()+86400000).toISOString()};
const context={userId:'10000000-0000-4000-8000-000000000001',conversationId:'20000000-0000-4000-8000-000000000001',requestId:'30000000-0000-4000-8000-000000000001',provider:'openrouter' as const,model:'fixture/chat',channel:'telegram' as const};

Deno.test('Usage normalization: cached/creation/reasoning tokens are counted once; free, missing and expired prices remain distinct',()=>{
 const open=extractUsage('openai',{usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:40},output_tokens_details:{reasoning_tokens:10}}},price);
 assert.equal(open.cost_usd,0.000324);assert.equal(open.input_tokens,100);assert.equal(open.output_tokens,20);assert.equal(open.reasoning_tokens,10);
 const claude=extractUsage('anthropic',{usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:40,cache_creation_input_tokens:30,cache_creation:{ephemeral_5m_input_tokens:10,ephemeral_1h_input_tokens:20}}},price);
 assert.equal(claude.input_tokens,170);assert.equal(claude.cost_usd,0.000509);
 assert.equal(extractUsage('openrouter',{usage:{prompt_tokens:100,completion_tokens:10,cost:0}},null).cost_kind,'reported');
 assert.equal(extractUsage('openrouter',{usage:{prompt_tokens:100,completion_tokens:10,cost:0}},null).cost_usd,0);
 assert.equal(extractUsage('openrouter',{usage:{prompt_tokens:100,completion_tokens:10}},null).cost_usd,null);
 assert.equal(extractUsage('openai',{usage:{input_tokens:10,output_tokens:2}},null).cost_kind,'unknown');
 assert.equal(extractUsage('openai',{usage:{input_tokens:10,output_tokens:2}},{...price,valid_until:'2020-01-01T00:00:00Z'}).cost_kind,'unknown');
 assert.equal(extractUsage('openai',{usage:{input_tokens:100001,output_tokens:2}},price).cost_kind,'unknown');
 assert.equal(extractUsage('deepseek',{usage:{prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:40}},price).cost_usd,0.000224);
 assert.equal(extractUsage('openai',{usage:{input_tokens:-1,output_tokens:2}},price).input_tokens,null);
 assert.equal(extractUsage('openrouter',{usage:{cost:-1}},null).cost_kind,'unknown');
});

Deno.test('OpenRouter validates the key before a tools/text-only catalog; preserves reasoning/tool results and records each paid step',async()=>{
 const original=globalThis.fetch;let step=0,executed=0;const events:string[]=[];
 globalThis.fetch=(async(url,init)=>{
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fixture-not-a-real-key');assert.equal(init?.redirect,'error');
  if(String(url).endsWith('/key'))return json({data:{is_management_key:false}});
  if(String(url).includes('/models?'))return json({data:[{id:'fixture/chat',name:'Fixture Chat',supported_parameters:['tools'],architecture:{output_modalities:['text']}},{id:'fixture/image',name:'Image',supported_parameters:['tools'],architecture:{output_modalities:['image']}},{id:'fixture/no-tools',name:'No tools',supported_parameters:[]}]});
  assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');const body=JSON.parse(String(init?.body));assert.equal(body.provider.require_parameters,true);
  if(++step===1)return json({usage:{prompt_tokens:100,completion_tokens:10,cost:0.001},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,reasoning_details:[{type:'reasoning.encrypted',data:'opaque-fixture'}],tool_calls:[{id:'allowed',type:'function',function:{name:'list_notes',arguments:'{}'}},{id:'forbidden',type:'function',function:{name:'execute_sql',arguments:'{}'}}]}}]});
  assert.ok(JSON.stringify(body.messages).includes('opaque-fixture'));assert.ok(JSON.stringify(body.messages).includes('Herramienta no permitida'));
  return json({usage:{prompt_tokens:200,completion_tokens:20,cost:0.002},choices:[{finish_reason:'stop',message:{role:'assistant',content:'Respuesta de prueba'}}]});
 })as typeof fetch;
 try{
  assert.deepEqual(await openrouter.listModels('fixture-not-a-real-key',AbortSignal.timeout(5000)),[{id:'fixture/chat',name:'Fixture Chat'}]);
  const input:Generation={key:'fixture-not-a-real-key',model:'fixture/chat',messages:[{role:'user',content:'Notas'}],system:'fixture',signal:AbortSignal.timeout(5000),tools:[{name:'list_notes',description:'fixture',parameters:{}}],execute:async()=>{executed++;return {notes:[]};},
   usage:{start:async i=>{events.push(`start${i}`)},complete:async(i,raw)=>{events.push(`complete${i}:${extractUsage('openrouter',raw,null).cost_usd}`)},failed:async()=>{throw new Error('unexpected failure')}}};
  assert.equal(await openrouter.generate(input),'Respuesta de prueba');assert.equal(executed,1);assert.deepEqual(events,['start0','complete0:0.001','start1','complete1:0.002']);
  globalThis.fetch=(async()=>json({error:{message:'fixture-secret'}},401))as typeof fetch;
  await assert.rejects(()=>openrouter.listModels('fixture-not-a-real-key',AbortSignal.timeout(5000)),error=>error instanceof Error&&!error.message.includes('fixture-secret'));
 }finally{globalThis.fetch=original;}
});

Deno.test('Durable metering reserves before billing, keeps unknown failures visible and retains usage for truncated responses',async()=>{
 const original=globalThis.fetch;const ledger:Record<string,unknown>[]=[];let network=0;let failReservation=false;let truncated=false;
 const admin=createClient('http://localhost:54321','fixture-service',{auth:{persistSession:false}});
 globalThis.fetch=(async(input,init)=>{
  const req=input instanceof Request?input:new Request(input,init),url=new URL(req.url);
  if(url.hostname==='api.openai.com'){network++;if(!truncated)throw new TypeError('fixture timeout');return json({status:'incomplete',usage:{input_tokens:100,output_tokens:20},output:[]});}
  if(url.pathname.endsWith('chat_model_prices'))return json(null);
  const body=await req.json();if(req.method==='POST'){if(failReservation)return json({message:'fixture storage unavailable'},503);ledger.push(body);}else Object.assign(ledger[ledger.length-1],body);
  return json(null,req.method==='POST'?201:200);
 })as typeof fetch;
 try{
  const base:Generation={key:'fixture-not-a-real-key',model:'fixture',system:'fixture',messages:[],tools:[],signal:AbortSignal.timeout(5000),execute:async()=>null};
  await assert.rejects(()=>openai.generate({...base,usage:createUsageRecorder(admin,{...context,provider:'openai'})}));assert.equal(ledger[0].state,'unconfirmed');assert.equal(ledger[0].channel,'telegram');
  failReservation=true;await assert.rejects(()=>openai.generate({...base,usage:createUsageRecorder(admin,{...context,provider:'openai'})}),/registrar el consumo/);assert.equal(network,1);
  failReservation=false;truncated=true;await assert.rejects(()=>openai.generate({...base,usage:createUsageRecorder(admin,{...context,provider:'openai'})}),/incompleta/);assert.equal(ledger[1].input_tokens,100);assert.equal(ledger[1].state,'received');
 }finally{globalThis.fetch=original;}
});
