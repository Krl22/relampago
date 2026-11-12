import { z } from "npm:zod@4.3.6";
import { ChatError, type Provider } from "./validation.ts";
import type {UsageRecorder} from './usage.ts';

export interface Model { id: string; name: string }
export interface Tool { name: string; description: string; parameters: Record<string, unknown> }
export interface Message { role: "user" | "assistant"; content: string }
export interface Generation {
  key: string; model: string; system: string; messages: Message[]; tools: Tool[]; signal: AbortSignal;
  execute: (name: string, args: unknown) => Promise<unknown>;
  usage?:UsageRecorder;
}
export interface ProviderAdapter {
  listModels: (key: string, signal: AbortSignal) => Promise<Model[]>;
  generate: (input: Generation) => Promise<string>;
}

// Endpoints are compiled in, never supplied by the browser or model (SSRF/key exfiltration).
async function request(url: string, key: string, provider: Provider, signal: AbortSignal, body?: unknown) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET", signal, redirect: "error",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      ...(provider === "anthropic" ? { "anthropic-version": "2026-10-21" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Never return provider response bodies: they may echo keys, prompts or private data.
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw new ChatError(400, "El proveedor rechazó la clave o el acceso al modelo.");
    if (response.status === 402) throw new ChatError(400, "No hay saldo disponible en tu cuenta del proveedor.");
    if (response.status === 429) throw new ChatError(429, "El proveedor alcanzó su límite de uso o saldo. Revisa tu cuenta.");
    throw new ChatError(502, "El proveedor no pudo completar la solicitud. Prueba otro modelo o inténtalo más tarde.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ChatError(502, "Respuesta vacía del proveedor.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new ChatError(502, "Respuesta del proveedor demasiado grande.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new ChatError(502, "Respuesta inválida del proveedor."); }
}

const modelResponse = z.object({ data: z.array(z.object({ id: z.string(), display_name: z.string().optional() })) });
const openAIResponse = z.object({ status: z.string(), output: z.array(z.object({ type: z.string() }).passthrough()) });
const functionCall = z.object({ call_id: z.string(), name: z.string(), arguments: z.string() });
const textMessage = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()) });
const claudeResponse = z.object({ stop_reason: z.string(), content: z.array(z.object({ type: z.string() }).passthrough()) });
const claudeCall = z.object({ id: z.string(), name: z.string(), input: z.unknown() });

async function completion(input:Generation,step:number,provider:Provider,url:string,body:unknown){
  await input.usage?.start(step);
  let raw:unknown;
  try{raw=await request(url,input.key,provider,input.signal,body);}
  catch(error){await input.usage?.failed(step);throw error;}
  // Persist even truncated/malformed answers before validating the message/tool payload.
  await input.usage?.complete(step,raw);
  return raw;
}

async function executeTool(input: Generation, name: string, args: unknown) {
  // Unknown tools/invalid arguments don't become arbitrary code or database queries.
  if (!input.tools.some(t => t.name === name)) return { error: "Herramienta no permitida." };
  try { return await input.execute(name, args); }
  catch (error) {
    if (error instanceof z.ZodError) return { error: "Argumentos inválidos. Revisa los filtros y el intervalo máximo de 31 días." };
    throw error;
  }
}

export const openai: ProviderAdapter = {
  async listModels(key, signal) {
    const { data } = modelResponse.parse(await request("https://api.openai.com/v1/models", key, "openai", signal));
    return data.filter(m => /^(gpt-|chatgpt-|o[1-9])/.test(m.id)
      && !/(audio|realtime|transcribe|tts|image|search|instruct|codex|deep-research)/.test(m.id))
      .map(m => ({ id: m.id, name: m.id })).sort((a, b) => b.id.localeCompare(a.id));
  },
  async generate(input) {
    const history: unknown[] = [...input.messages];
    let toolCount = 0;
    for (let step = 0; step < 4; step++) {
      const result = openAIResponse.parse(await completion(input,step,"openai","https://api.openai.com/v1/responses", {
        model: input.model, instructions: input.system, input: history, store: false,
        include: ["reasoning.encrypted_content"], max_output_tokens: 2048,
        tools: input.tools.map(t => ({ type: "function", ...t, strict: true })),
      }));
      if (result.status !== "completed") throw new ChatError(502, "La respuesta quedó incompleta. Prueba una consulta más breve.");
      const calls = result.output.filter(item => item.type === "function_call");
      if (!calls.length) return result.output.filter(item => item.type === "message")
        .flatMap(item => textMessage.parse(item).content)
        .filter(part => part.type === "output_text").map(part => part.text ?? "").join("\n");
      if ((toolCount += calls.length) > 6) throw new ChatError(422, "La consulta requiere demasiadas operaciones. Divídela en partes.");
      // Preserve reasoning items as well as function calls for stateless Responses requests.
      history.push(...result.output);
      for (const item of calls) {
        const call = functionCall.parse(item);
        let args: unknown;
        try { args = JSON.parse(call.arguments); } catch { args = null; }
        history.push({ type: "function_call_output", call_id: call.call_id,
          output: JSON.stringify(await executeTool(input, call.name, args)) });
      }
    }
    throw new ChatError(422, "Simplifica la consulta para poder responder.");
  },
};

export const anthropic: ProviderAdapter = {
  async listModels(key, signal) {
    const { data } = modelResponse.parse(await request("https://api.anthropic.com/v1/models?limit=100", key, "anthropic", signal));
    return data.filter(m => m.id.startsWith("claude-"))
      .map(m => ({ id: m.id, name: m.display_name ?? m.id }));
  },
  async generate(input) {
    const history: unknown[] = [...input.messages];
    let toolCount = 0;
    for (let step = 0; step < 4; step++) {
      const result = claudeResponse.parse(await completion(input,step,"anthropic","https://api.anthropic.com/v1/messages", {
        model: input.model, system: input.system, messages: history, max_tokens: 2048,
        tools: input.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      }));
      const calls = result.content.filter(item => item.type === "tool_use");
      if (!calls.length) {
        if (result.stop_reason !== "end_turn") throw new ChatError(502, "La respuesta quedó incompleta. Prueba una consulta más breve.");
        return result.content.filter(item => item.type === "text").map(item => z.string().parse(item.text)).join("\n");
      }
      if ((toolCount += calls.length) > 6) throw new ChatError(422, "La consulta requiere demasiadas operaciones. Divídela en partes.");
      history.push({ role: "assistant", content: result.content });
      const results = [];
      for (const item of calls) {
        const call = claudeCall.parse(item);
        results.push({ type: "tool_result", tool_use_id: call.id,
          content: JSON.stringify(await executeTool(input, call.name, call.input)) });
      }
      history.push({ role: "user", content: results });
    }
    throw new ChatError(422, "Simplifica la consulta para poder responder.");
  },
};

const deepseekModels=z.object({data:z.array(z.object({id:z.string(),name:z.string().optional()}))});
const deepseekResponse=z.object({choices:z.array(z.object({finish_reason:z.string(),message:z.object({
  role:z.literal('assistant'),content:z.string().nullable().optional(),reasoning_content:z.string().nullable().optional(),
  tool_calls:z.array(z.object({id:z.string(),type:z.literal('function'),function:z.object({name:z.string(),arguments:z.string()})})).nullable().optional(),
})})).min(1).max(1)});

export const deepseek:ProviderAdapter={
  async listModels(key,signal){
    const {data}=deepseekModels.parse(await request('https://api.deepseek.com/models',key,'deepseek',signal));
    return data.filter(model=>/^deepseek-[a-zA-Z0-9._-]+$/.test(model.id))
      .map(model=>({id:model.id,name:model.name??model.id}));
  },
  async generate(input){
    // Plain conversation history travels across providers. Tool/reasoning state stays within this turn.
    const history:unknown[]=[{role:'system',content:input.system},...input.messages];
    let toolCount=0;
    for(let step=0;step<4;step++){
      const {choices}=deepseekResponse.parse(await completion(input,step,'deepseek','https://api.deepseek.com/chat/completions',{
        model:input.model,messages:history,max_tokens:2048,stream:false,thinking:{type:'disabled'},
        tools:input.tools.map(tool=>({type:'function',function:tool})),
      }));
      const {message,finish_reason}=choices[0];const calls=message.tool_calls??[];
      if(!calls.length){
        if(finish_reason!=='stop')throw new ChatError(502,'La respuesta quedó incompleta. Prueba una consulta más breve.');
        return message.content??'';
      }
      if(finish_reason!=='tool_calls')throw new ChatError(502,'La respuesta quedó incompleta. Prueba una consulta más breve.');
      if((toolCount+=calls.length)>6)throw new ChatError(422,'La consulta requiere demasiadas operaciones. Divídela en partes.');
      // Preserve complete assistant tool calls (including optional reasoning) for protocol continuity.
      history.push(message);
      for(const call of calls){
        let args:unknown;try{args=JSON.parse(call.function.arguments);}catch{args=null;}
        history.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(await executeTool(input,call.function.name,args))});
      }
    }
    throw new ChatError(422,'Simplifica la consulta para poder responder.');
  },
};

const routerModels=z.object({data:z.array(z.object({id:z.string(),name:z.string(),supported_parameters:z.array(z.string()).optional(),
 architecture:z.object({output_modalities:z.array(z.string()).optional()}).optional()}))});
export const openrouter:ProviderAdapter={
 async listModels(key,signal){
  // The catalog is public. Validate the actual inference key separately before saving it.
  const verified=z.object({data:z.object({is_management_key:z.boolean().optional()})}).parse(await request('https://openrouter.ai/api/v1/key',key,'openrouter',signal));
  if(verified.data.is_management_key)throw new ChatError(400,'Usa una clave de chat de OpenRouter, no una clave de administración.');
  const {data}=routerModels.parse(await request('https://openrouter.ai/api/v1/models?supported_parameters=tools&output_modalities=text',key,'openrouter',signal));
  return data.filter(model=>model.supported_parameters?.includes('tools')&&model.id.length<=150&&/^[a-zA-Z0-9._:/-]+$/.test(model.id)
   &&(!model.architecture?.output_modalities||model.architecture.output_modalities.includes('text'))).map(model=>({id:model.id,name:model.name}));
 },
 async generate(input){
  const history:unknown[]=[{role:'system',content:input.system},...input.messages];let count=0;
  for(let step=0;step<4;step++){
   const raw=await completion(input,step,'openrouter','https://openrouter.ai/api/v1/chat/completions',{
    model:input.model,messages:history,max_tokens:2048,stream:false,provider:{require_parameters:true},
    tools:input.tools.map(tool=>({type:'function',function:tool})),
   });
   const parsed=z.object({choices:z.array(z.object({finish_reason:z.string(),message:z.object({role:z.literal('assistant'),content:z.string().nullable().optional(),
    reasoning_details:z.array(z.unknown()).nullable().optional(),tool_calls:z.array(z.object({id:z.string(),type:z.literal('function'),function:z.object({name:z.string(),arguments:z.string()})})).nullable().optional()})})).min(1).max(1)}).parse(raw);
   const {message,finish_reason}=parsed.choices[0];const calls=message.tool_calls??[];
   if(!calls.length){if(finish_reason!=='stop')throw new ChatError(502,'La respuesta quedó incompleta. Prueba una consulta más breve.');return message.content??'';}
   if(finish_reason!=='tool_calls')throw new ChatError(502,'La respuesta quedó incompleta. Prueba una consulta más breve.');
   if((count+=calls.length)>6)throw new ChatError(422,'La consulta requiere demasiadas operaciones. Divídela en partes.');
   history.push(message);
   for(const call of calls){let args:unknown;try{args=JSON.parse(call.function.arguments);}catch{args=null;}
    history.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(await executeTool(input,call.function.name,args))});}
  }
  throw new ChatError(422,'Simplifica la consulta para poder responder.');
 },
};

// Add Qwen/Kimi as separate adapters, with fixed approved URLs,
// model discovery and provider-specific contract tests before enabling their keys.
export const providers: Record<Provider, ProviderAdapter> = { openai, anthropic, deepseek, openrouter };
