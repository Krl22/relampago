import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.95.3';
import {ChatError,type Provider} from './validation.ts';

export interface UsageRecorder{start:(step:number)=>Promise<void>;complete:(step:number,raw:unknown)=>Promise<void>;failed:(step:number)=>Promise<void>}
export interface Price{input_per_million:number;output_per_million:number;cached_per_million:number;write_short_per_million:number|null;
 write_long_per_million:number|null;max_input_tokens:number;source_url:string;price_note:string;verified_at:string;valid_until:string}
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1_000_000_000?v:null;
const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<100_000_000?v:null;

export function extractUsage(provider:Provider,raw:unknown,price:Price|null){
 const u=object(object(raw).usage),details=object(u.input_tokens_details??u.prompt_tokens_details);
 let input=count(provider==='anthropic'||provider==='openai'?u.input_tokens:u.prompt_tokens);
 const output=count(provider==='anthropic'||provider==='openai'?u.output_tokens:u.completion_tokens);
 const cached=count(provider==='anthropic'?u.cache_read_input_tokens:provider==='deepseek'?u.prompt_cache_hit_tokens:details.cached_tokens)??0;
 const writes=count(provider==='anthropic'?u.cache_creation_input_tokens:details.cache_write_tokens)??0;
 const creation=object(u.cache_creation);
 const longWrites=provider==='anthropic'?(count(creation.ephemeral_1h_input_tokens)??0):0;
 const shortWrites=provider==='anthropic'?(count(creation.ephemeral_5m_input_tokens)??Math.max(0,writes-longWrites)):writes;
 if(provider==='anthropic'&&input!==null)input+=cached+writes;
 const reasoning=count(object(u.output_tokens_details??u.completion_tokens_details).reasoning_tokens)??0;
 const valid=input!==null&&output!==null&&cached+writes<=input&&longWrites+shortWrites===writes&&reasoning<=output;
 let cost:number|null=null;let kind:'reported'|'estimated'|'unknown'='unknown';let note:string|null=null;
 if(provider==='openrouter'){
  cost=money(u.cost);
  if(cost!==null){kind='reported';note=u.is_byok===true?'Cargo de OpenRouter; el proveedor BYOK puede facturar aparte.':'Cargo de la respuesta informado por OpenRouter; no incluye recargas ni impuestos.';}
 }else if(valid&&price&&Date.parse(price.valid_until)>Date.now()&&input!<=Number(price.max_input_tokens)
   &&!(provider==='openai'&&writes>0)&&!(provider==='deepseek'&&count(u.prompt_cache_hit_tokens)===null)){
  const rates=[price.input_per_million,price.output_per_million,price.cached_per_million,
   shortWrites?price.write_short_per_million:0,longWrites?price.write_long_per_million:0].map(v=>v===null?NaN:Number(v));
  if(rates.every(rate=>Number.isFinite(rate)&&rate>=0)){
   cost=((input!-cached-writes)*rates[0]+output!*rates[1]+cached*rates[2]+shortWrites*rates[3]+longWrites*rates[4])/1_000_000;
   kind='estimated';note=price.price_note;
  }
 }
 return {input_tokens:valid?input:null,output_tokens:valid?output:null,cached_tokens:valid?cached:null,cache_write_tokens:valid?writes:null,
  reasoning_tokens:valid?reasoning:null,cost_usd:cost===null?null:Number(cost.toFixed(12)),cost_kind:kind,price_note:note,
  price_source:kind==='estimated'?price!.source_url:kind==='reported'?'https://openrouter.ai/docs/cookbook/administration/usage-accounting':null,
  price_verified_at:kind==='estimated'?price!.verified_at:null};
}

export function createUsageRecorder(admin:SupabaseClient,context:{userId:string;conversationId:string;requestId:string;provider:Provider;model:string;channel:'web'|'telegram'}):UsageRecorder{
 const fail=()=>new ChatError(503,'No se pudo registrar el consumo. Revisa Mi consumo antes de reintentar.');
 return {
  async start(step){
   // Reserve durably BEFORE a paid call; a crash remains visible as unconfirmed.
   const {error}=await admin.from('chat_usage_calls').insert({user_id:context.userId,conversation_id:context.conversationId,
    request_id:context.requestId,turn_id:context.requestId,provider:context.provider,model:context.model,channel:context.channel,step});
   if(error)throw fail();
  },
  async complete(step,raw){
   let price:Price|null=null;
   if(context.provider!=='openrouter'){
    const result=await admin.from('chat_model_prices').select('*').eq('provider',context.provider).eq('model',context.model).maybeSingle();
    if(!result.error)price=result.data;
   }
   const usage=extractUsage(context.provider,raw,price);
   const {error}=await admin.from('chat_usage_calls').update({...usage,state:'received',updated_at:new Date().toISOString()})
    .eq('user_id',context.userId).eq('turn_id',context.requestId).eq('step',step);
   if(error)throw fail();
  },
  async failed(step){
   const {error}=await admin.from('chat_usage_calls').update({state:'unconfirmed',updated_at:new Date().toISOString()})
    .eq('user_id',context.userId).eq('turn_id',context.requestId).eq('step',step).eq('state','pending');
   if(error)throw fail();
  },
 };
}
