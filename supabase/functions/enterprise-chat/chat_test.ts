import assert from "node:assert/strict";
import { decryptKey, encryptKey } from "./crypto.ts";
import { anthropic, openai, deepseek, type Generation } from "./providers.ts";
import { createHandler } from "./handler.ts";
import { noArgs, orderArgs, requestSchema } from "./validation.ts";
import { makeToolExecutor, tools,toolsForProfile } from "./tools.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.3";

// Deliberately non-credential test markers; all HTTP calls are intercepted.
const marker = "test-only-not-a-provider-credential";
const master = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const userId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.test("AES-GCM: randomized ciphertext, authenticated owner/provider binding and tamper rejection", async () => {
  const first = await encryptKey(marker, userId, "openai", master);
  const second = await encryptKey(marker, userId, "openai", master);
  assert.notEqual(first, second);
  assert.equal(first.includes(marker), false);
  assert.equal(await decryptKey(first, userId, "openai", master), marker);
  await assert.rejects(() => decryptKey(first, "another-user", "openai", master));
  await assert.rejects(() => decryptKey(first, userId, "anthropic", master));
  await assert.rejects(() => decryptKey(first.slice(0, -4) + "AAAA", userId, "openai", master));
  await assert.rejects(() => encryptKey(marker, userId, "openai", "short"));
});

Deno.test("validation: rejects spoofed ownership, arbitrary SQL/providers/history, oversized input and invalid filters", () => {
  const valid = { action: "send", conversation_id: conversationId, request_id: requestId, provider: "openai", model: "test-model", content: "Hola" };
  requestSchema.parse(valid);
  for (const payload of [{ ...valid, user_id: userId }, { ...valid, history: [] }, { ...valid, sql: "select 1" },
    { ...valid, provider: "qwen" }, { ...valid, content: "x".repeat(8001) }, { ...valid, model: "https://evil.invalid/?key=" },
    { action: "save_key", provider: "openai", key: "credential\nnewline" }]) assert.equal(requestSchema.safeParse(payload).success, false);
  for (const args of [{ from: "2026-01-01", to: "2026-03-01", status: null },
    { from: "2026-02-30", to: "2026-03-01", status: null }, { from: "2026-01-02", to: "2026-01-01", status: null },
    { from: "2026-01-01", to: "2026-01-01", status: null, company_id: "other" }]) assert.equal(orderArgs.safeParse(args).success, false);
  assert.equal(noArgs.safeParse({ sql: "drop table orders" }).success, false);
});

function generation(execute: Generation["execute"]): Generation {
  return { key: marker, model: "test-model", system: "Test instructions", messages: [{ role: "user", content: "Consulta mis notas" }],
    tools, signal: AbortSignal.timeout(5000), execute };
}

Deno.test("OpenAI adapter: stateless Responses tool round trip preserves reasoning and sends store:false", async () => {
  const original = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    return bodies.length === 1 ? json({ status: "completed", output: [
      { type: "reasoning", id: "reasoning", encrypted_content: "opaque-test-data" },
      { type: "function_call", call_id: "c1", name: "list_notes", arguments: "{}" },
    ] }) : json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Tienes una nota." }] }] });
  }) as typeof fetch;
  try {
    let calls = 0;
    assert.equal(await openai.generate(generation(async (name, args) => {
      calls++; assert.equal(name, "list_notes"); noArgs.parse(args); return { notes: [{ body: "Prueba" }] };
    })), "Tienes una nota.");
    assert.equal(calls, 1); assert.equal(bodies[0].store, false);
    assert.ok(JSON.stringify(bodies[1].input).includes("opaque-test-data"));
    assert.ok(JSON.stringify(bodies[1].input).includes("function_call_output"));
  } finally { globalThis.fetch = original; }
});

Deno.test("Claude adapter: portable history and tool results; unsafe tool names never execute", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(init?.body));
    if (++count === 1) return json({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "execute_sql", input: { sql: "SELECT 1" } }] });
    assert.ok(JSON.stringify(body.messages).includes("Herramienta no permitida"));
    return json({ stop_reason: "end_turn", content: [{ type: "text", text: "No tengo esa herramienta." }] });
  }) as typeof fetch;
  try {
    assert.equal(await anthropic.generate(generation(async () => { throw new Error("Unknown tool executed"); })), "No tengo esa herramienta.");
  } finally { globalThis.fetch = original; }
});

Deno.test("provider failures are sanitized; incomplete answers are rejected", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => json({ error: { message: marker } }, 401)) as typeof fetch;
    await assert.rejects(() => openai.generate(generation(async () => ({}))), error => error instanceof Error && !error.message.includes(marker));
    globalThis.fetch = (async () => json({ status: "incomplete", output: [] })) as typeof fetch;
    await assert.rejects(() => openai.generate(generation(async () => ({}))), /incompleta/);
  } finally { globalThis.fetch = original; }
});

Deno.test('DeepSeek: discovers actual models and preserves tool calls, reports, reasoning and read-only restrictions',async()=>{
  const original=globalThis.fetch;let step=0;const executed:string[]=[];
  globalThis.fetch=(async(url,init)=>{
    assert.equal(new Headers(init?.headers).get('Authorization'),`Bearer ${marker}`);
    assert.equal(init?.redirect,'error');assert.ok(init?.signal);
    if(url==='https://api.deepseek.com/models')return json({data:[{id:'deepseek-fixture-chat',name:'DeepSeek fixture'},{id:'unrelated-image-model'}]});
    assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(String(init?.body));
    assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.max_tokens,2048);assert.equal(body.messages[0].role,'system');
    assert.ok(body.tools.some((tool:{function:{name:string}})=>tool.function.name==='create_report'));
    if(++step===1)return json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,reasoning_content:'transient-fixture-reasoning',tool_calls:[
      {id:'report1',type:'function',function:{name:'create_report',arguments:JSON.stringify({dataset:'notes',format:'pdf'})}},
      {id:'unsafe1',type:'function',function:{name:'execute_sql',arguments:'{"sql":"delete from orders"}'}},
    ]}}]});
    assert.equal(body.messages[2].reasoning_content,'transient-fixture-reasoning');
    assert.equal(body.messages[3].tool_call_id,'report1');assert.equal(body.messages[4].tool_call_id,'unsafe1');
    assert.ok(body.messages[4].content.includes('Herramienta no permitida'));
    return json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Reporte de notas preparado.'}}]});
  })as typeof fetch;
  try{
    assert.deepEqual(await deepseek.listModels(marker,AbortSignal.timeout(5000)),[{id:'deepseek-fixture-chat',name:'DeepSeek fixture'}]);
    const answer=await deepseek.generate(generation(async(name,args)=>{executed.push(name);assert.deepEqual(args,{dataset:'notes',format:'pdf'});return {report:{filename:'notas.pdf'}};}));
    assert.equal(answer,'Reporte de notas preparado.');assert.deepEqual(executed,['create_report']);assert.ok(!answer.includes('reasoning'));
  }finally{globalThis.fetch=original;}
});

Deno.test('DeepSeek: rejects truncated tool calls, excessive operations, exhausted balance and unsafe provider errors',async()=>{
  const original=globalThis.fetch;let executed=0;const input=generation(async()=>{executed++;return {};});
  try{
    for(const status of [401,402,429,500]){
      globalThis.fetch=(async()=>json({error:{message:marker}},status))as typeof fetch;
      await assert.rejects(()=>deepseek.generate(input),e=>e instanceof Error&&!e.message.includes(marker));
    }
    globalThis.fetch=(async()=>json({choices:[{finish_reason:'length',message:{role:'assistant',content:'partial',tool_calls:[{id:'1',type:'function',function:{name:'list_notes',arguments:'{}'}}]}}]}))as typeof fetch;
    await assert.rejects(()=>deepseek.generate(input),/incompleta/);assert.equal(executed,0);
    globalThis.fetch=(async()=>json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:Array.from({length:7},(_,i)=>({id:String(i),type:'function',function:{name:'list_notes',arguments:'{}'}}))}}]}))as typeof fetch;
    await assert.rejects(()=>deepseek.generate(input),/demasiadas/);assert.equal(executed,0);
  }finally{globalThis.fetch=original;}
});

Deno.test("tool queries use caller JWT, explicit company/courier scope, approved columns and row limits", async () => {
  const original = globalThis.fetch;
  const seen: URL[] = [];
  globalThis.fetch = (async (url, init) => {
    const req = url instanceof Request ? url : new Request(url, init);
    assert.equal(req.headers.get("Authorization"), `Bearer ${marker}`);
    seen.push(new URL(req.url));
    return new Response("[]", { headers: { "Content-Type": "application/json", "Content-Range": "*/80" } });
  }) as typeof fetch;
  try {
    const caller = createClient("http://localhost:54321", "public-test-marker", { global: { headers: { Authorization: `Bearer ${marker}` } }, auth: { persistSession: false } });
    const args = { from: "2026-11-03", to: "2026-11-03", status: null };
    const execute = makeToolExecutor(caller, { id: userId, role: "client", company_id: conversationId });
    await execute("list_orders", args);
    assert.equal(seen[0].searchParams.get("company_id"), `eq.${conversationId}`);
    assert.equal(seen[0].searchParams.get("limit"), "50");
    assert.ok(!seen[0].searchParams.get("select")?.includes("phone"));
    await makeToolExecutor(caller, { id: userId, role: "courier", company_id: null })("list_orders", args);
    assert.equal(seen[1].searchParams.get("assigned_courier"), `eq.${userId}`);
    await assert.rejects(() => execute("execute_sql", {}), /no permitida/);
    await assert.rejects(() => execute("list_orders", { ...args, company_id: "other" }));
  } finally { globalThis.fetch = original; }
});

Deno.test("business assistant is strictly read-only: all mutation tool names are rejected before database access", async () => {
  const original=globalThis.fetch;
  let accesses=0;
  globalThis.fetch=(()=>{accesses++;throw new Error("A write tool must not reach the database");}) as typeof fetch;
  try {
    assert.deepEqual(tools.map(tool=>tool.name).sort(),["create_report","list_notes","list_orders","order_summary"]);
    const caller=createClient("http://localhost:54321","fixture",{auth:{persistSession:false}});
    const execute=makeToolExecutor(caller,{id:userId,role:"admin",company_id:null});
    for(const name of ["create_order","update_order","delete_order","update_stock","create_client","save_note","delete_note","execute_sql"])
      await assert.rejects(()=>execute(name,{}),/no permitida/);
    assert.equal(accesses,0);
  } finally {globalThis.fetch=original;}
});

Deno.test("activity discovery is role-scoped; fixed read-only RPCs validate filters and cannot spoof the viewer",async()=>{
  const original=globalThis.fetch;const seen:{url:string;body:Record<string,unknown>}[]=[];
  globalThis.fetch=(async(input,init)=>{
    const req=input instanceof Request?input:new Request(input,init);
    seen.push({url:req.url,body:await req.json()});
    return json({source:'order_events',coverage:{records_all_database_edits:false},events:[]});
  }) as typeof fetch;
  try{
    const caller=createClient('http://localhost:54321','fixture',{auth:{persistSession:false}});
    for(const role of ['client','courier'] as const){
      const profile={id:userId,role,company_id:conversationId};
      assert.equal(toolsForProfile(profile).some(t=>t.name==='user_activity'),false);
      await assert.rejects(()=>makeToolExecutor(caller,profile)('user_activity',{user_id:null,from:null,to:null}),/permiso/);
    }
    assert.equal(seen.length,0);
    const profile={id:userId,role:'admin' as const,company_id:null};
    assert.deepEqual(toolsForProfile(profile).map(t=>t.name).sort(),['create_report','find_users','list_notes','list_orders','order_summary','user_activity']);
    const execute=makeToolExecutor(caller,profile);
    const result=await execute('user_activity',{user_id:conversationId,from:null,to:null});
    assert.equal(result.coverage.records_all_database_edits,false);
    assert.equal(seen[0].body.p_actor_id,conversationId);
    assert.equal('p_viewer_id' in seen[0].body,false);
    await makeToolExecutor(caller,profile,true)('find_users',{query:null,role:'admin'});
    assert.equal(seen[1].body.p_viewer_id,userId);
    await assert.rejects(()=>execute('find_users',{query:'Admin',role:null,p_viewer_id:conversationId}));
    await assert.rejects(()=>execute('user_activity',{user_id:null,from:'2026-11-04',to:'2026-10-01'}));
    assert.equal(seen.length,2);
  }finally{globalThis.fetch=original;}
});

Deno.test("endpoint: origin allowlist, missing/expired sessions and strict identity validation", async () => {
  const original = globalThis.fetch;
  const handler = createHandler({ url: "http://localhost:54321", anonKey: "test-public", serviceKey: "test-service", encryptionKey: master, origins: ["http://localhost:5173"] });
  assert.equal((await handler(new Request("http://local", { method: "OPTIONS", headers: { Origin: "https://evil.invalid" } }))).status, 403);
  const preflight = await handler(new Request("http://local", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } }));
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  const noAuth = await handler(new Request("http://local", { method: "POST" }));
  assert.equal(noAuth.status, 401); await noAuth.body?.cancel();
  globalThis.fetch = (async url => {
    const path = new URL(url instanceof Request ? url.url : String(url)).pathname;
    if (path === "/auth/v1/user") return json({ id: userId, app_metadata: {}, is_anonymous: false });
    if (path === "/rest/v1/profiles") return json({ id: userId, role: "admin", company_id: null });
    throw new Error(`Unexpected request ${path}`);
  }) as typeof fetch;
  try {
    const response = await handler(new Request("http://local", { method: "POST", headers: { Authorization: `Bearer ${marker}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bootstrap", user_id: "spoofed" }) }));
    assert.equal(response.status, 400); assert.equal(response.headers.get("Cache-Control"), "no-store"); await response.body?.cancel();
    globalThis.fetch = (async () => json({ message: "invalid token" }, 401)) as typeof fetch;
    const expired = await handler(new Request("http://local", { method: "POST", headers: { Authorization: `Bearer ${marker}`, "Content-Type": "application/json" }, body: "{}" }));
    assert.equal(expired.status, 401); await expired.body?.cancel();
  } finally { globalThis.fetch = original; }
});

Deno.test("endpoint integration: encrypted BYOK -> safe metadata -> tool query -> persisted answer -> replay -> Claude/DeepSeek with history", async () => {
  const original = globalThis.fetch;
  const credentials = new Map<string, string>();
  const completed: { role: string; content: string }[] = [];
  const runs = new Map<string, { content: string; status: string }>();
  let responses = 0, providerCalls = 0, businessReads = 0;
  const ledger:Record<string,unknown>[]=[];
  const handler = createHandler({ url: "http://localhost:54321", anonKey: "test-public", serviceKey: "test-service", encryptionKey: master, origins: [] });
  globalThis.fetch = (async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname === "api.openai.com") {
      providerCalls++;
      if (url.pathname === "/v1/models") return json({ data: [{ id: "gpt-test-contract" }] });
      const body = await req.json();
      assert.equal(body.store, false);
      if (++responses === 1) return json({ status: "completed", output: [{ type: "function_call", call_id: "orders1", name: "list_orders",
        arguments: JSON.stringify({ from: "2026-11-03", to: "2026-11-03", status: "pending" }) }] });
      assert.ok(JSON.stringify(body.input).includes("function_call_output"));
      return json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "OpenAI result" }] }] });
    }
    if (url.hostname === "api.anthropic.com") {
      providerCalls++;
      if (url.pathname === "/v1/models") return json({ data: [{ id: "claude-test-contract", display_name: "Test Claude" }] });
      const body = await req.json();
      assert.ok(JSON.stringify(body.messages).includes("OpenAI result"));
      return json({ stop_reason: "end_turn", content: [{ type: "text", text: "Claude result" }] });
    }
    if(url.hostname==='api.deepseek.com'){
      providerCalls++;
      if(url.pathname==='/models')return json({data:[{id:'deepseek-fixture-contract',name:'Fixture DeepSeek'}]});
      const body=await req.json();assert.ok(JSON.stringify(body.messages).includes('Claude result'));
      return json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'DeepSeek result'}}]});
    }
    if(url.hostname==='openrouter.ai'){
      providerCalls++;
      if(url.pathname==='/api/v1/key')return json({data:{is_management_key:false}});
      if(url.pathname==='/api/v1/models')return json({data:[{id:'fixture/chat',name:'Fixture Router',supported_parameters:['tools']}]});
      const body=await req.json();assert.ok(JSON.stringify(body.messages).includes('DeepSeek result'));
      return json({usage:{prompt_tokens:100,completion_tokens:20,cost:0.00025},choices:[{finish_reason:'stop',message:{role:'assistant',content:'Router result'}}]});
    }
    assert.equal(url.hostname, "localhost");
    if(url.pathname==='/rest/v1/chat_usage_calls'){
      const body=await req.json();
      if(req.method==='POST'){assert.equal(body.user_id,userId);assert.equal(body.channel,'web');ledger.push(body);}
      else {const entry=ledger.find(item=>`eq.${item.turn_id}`===url.searchParams.get('turn_id')&&`eq.${item.step}`===url.searchParams.get('step'));assert.ok(entry);Object.assign(entry,body);}
      return json(null,req.method==='POST'?201:200);
    }
    if(url.pathname==='/rest/v1/chat_model_prices')return json(null);
    if (url.pathname === "/auth/v1/user") return json({ id: userId, app_metadata: {}, is_anonymous: false });
    if (url.pathname === "/rest/v1/profiles") return json({ id: userId, role: "admin", company_id: null });
    if (url.pathname === "/rest/v1/chat_credentials") {
      if (req.method === "POST") {
        const body = await req.json(); assert.equal(body.user_id, userId);
        assert.notEqual(body.encrypted_key, marker); assert.ok(body.encrypted_key.startsWith("v1."));
        credentials.set(body.provider, body.encrypted_key); return json(null, 201);
      }
      assert.equal(url.searchParams.get("user_id"), `eq.${userId}`);
      const provider = url.searchParams.get("provider")?.slice(3);
      return provider ? json({ encrypted_key: credentials.get(provider) })
        : json([...credentials.keys()].map(provider => ({ provider, updated_at: new Date().toISOString() })));
    }
    if (url.pathname === "/rest/v1/chat_conversations") return json([{ id: conversationId, title: "Test", updated_at: new Date().toISOString() }]);
    if (url.pathname === "/rest/v1/chat_notes") return json([]);
    if (url.pathname === "/rest/v1/chat_messages") return json([...completed].reverse());
    if (url.pathname === "/rest/v1/orders") {
      assert.equal(req.headers.get("Authorization"), `Bearer ${marker}`);
      assert.equal(url.searchParams.get("company_id"), null);
      businessReads++; return json([{ order_number: 1, status: "pending" }]);
    }
    if (url.pathname === "/rest/v1/rpc/chat_begin_turn") {
      const body = await req.json(); assert.equal(body.p_user_id, userId);
      const run = runs.get(body.p_request_id);
      if (run) return json(run.status);
      runs.set(body.p_request_id, { content: body.p_content, status: "running" }); return json("started");
    }
    if (url.pathname === "/rest/v1/rpc/chat_finish_turn") {
      const body = await req.json(); const run = runs.get(body.p_request_id)!;
      run.status = body.p_content ? "completed" : "failed";
      if (body.p_content) completed.push({ role: "user", content: run.content }, { role: "assistant", content: body.p_content });
      return json(null);
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  }) as typeof fetch;
  const call = async (body: unknown) => {
    const response = await handler(new Request("http://local", { method: "POST",
      headers: { Authorization: `Bearer ${marker}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  try {
    await call({ action: "save_key", provider: "openai", key: marker });
    assert.equal(await decryptKey(credentials.get("openai")!, userId, "openai", master), marker);
    const bootstrap = await call({ action: "bootstrap" });
    assert.ok(!JSON.stringify(bootstrap).includes("encrypted_key"));
    assert.ok(!JSON.stringify(bootstrap).includes(marker));
    const send = { action: "send", conversation_id: conversationId, request_id: requestId, provider: "openai", model: "gpt-test-contract", content: "Consulta los pedidos" };
    await call(send);
    assert.equal(businessReads, 1); assert.equal(completed.length, 2);
    const callsBeforeReplay = providerCalls;
    assert.equal(ledger.length,2);
    assert.equal((await call(send)).cached, true); assert.equal(providerCalls, callsBeforeReplay);
    assert.equal(ledger.length,2);
    await call({ action: "save_key", provider: "anthropic", key: marker });
    await call({ ...send, request_id: "30000000-0000-4000-8000-000000000002", provider: "anthropic", model: "claude-test-contract", content: "Continúa con Claude" });
    assert.equal(completed.length, 4); assert.equal(completed[3].content, "Claude result");
    const saved=await call({action:'save_key',provider:'deepseek',key:marker});assert.equal(saved.models[0].id,'deepseek-fixture-contract');
    assert.equal(await decryptKey(credentials.get('deepseek')!,userId,'deepseek',master),marker);
    await assert.rejects(()=>decryptKey(credentials.get('deepseek')!,userId,'openai',master));
    await call({...send,request_id:'30000000-0000-4000-8000-000000000003',provider:'deepseek',model:'deepseek-fixture-contract',content:'Continúa con DeepSeek'});
    assert.equal(completed.length,6);assert.equal(completed[5].content,'DeepSeek result');
    await call({action:'save_key',provider:'openrouter',key:marker});
    assert.equal(await decryptKey(credentials.get('openrouter')!,userId,'openrouter',master),marker);
    await call({...send,request_id:'30000000-0000-4000-8000-000000000004',provider:'openrouter',model:'fixture/chat',content:'Continúa con OpenRouter'});
    assert.equal(completed[7].content,'Router result');assert.equal(ledger.length,5);
    assert.equal(ledger[4].cost_kind,'reported');assert.equal(ledger[4].cost_usd,0.00025);
  } finally { globalThis.fetch = original; }
});
