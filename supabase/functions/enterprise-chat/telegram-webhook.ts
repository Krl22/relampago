import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import { z } from "npm:zod@4.3.6";
import { readBody } from "./handler.ts";
import { equalSecret,sha256 } from "./telegram-api.ts";

export interface TelegramAccount {
  user_id:string;bot_id:number;bot_username:string;encrypted_token:string;webhook_id:string;webhook_secret_hash:string;
  link_hash:string|null;link_expires_at:string|null;pending_telegram_id:number|null;telegram_id:number|null;
  linked_at:string|null;model:string|null;provider:import('./validation.ts').Provider;conversation_id:string|null;
  reminders_enabled:boolean;blocked:boolean;
}
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const updateSchema=z.object({update_id:z.number().int().nonnegative(),message:z.object({
  message_id:id,date:z.number().int(),from:z.object({id,is_bot:z.boolean(),first_name:z.string().max(256).optional(),username:z.string().max(64).optional()}),
  chat:z.object({id:z.number().int(),type:z.string()}),text:z.string().max(8000).optional(),
}).optional()});

export function createTelegramWebhook(admin:SupabaseClient,kick:()=>void) {
  return async(req:Request)=>{
    const respond=(status=200)=>new Response(null,{status,headers:{"Cache-Control":"no-store"}});
    if(req.method!=="POST") return respond(405);
    const webhookId=new URL(req.url).pathname.split("/").filter(Boolean).at(-1);
    if(!z.uuid().safeParse(webhookId).success) return respond(404);
    const supplied=req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if(!supplied || supplied.length>256) return respond(401);
    try {
      const {data:account,error}=await admin.from("chat_telegram_accounts").select("*").eq("webhook_id",webhookId).maybeSingle();
      if(error) return respond(503);
      if(!account || !equalSecret(await sha256(supplied),account.webhook_secret_hash)) return respond(401);
      const mark=async(state:string)=>{
        await admin.from('chat_telegram_accounts').update({last_webhook_at:new Date().toISOString(),last_webhook_state:state}).eq('webhook_id',webhookId);
      };
      const notice=async(telegramId:number,text:string)=>{
        // A generic setup reply is public; it contains no account data and never invokes AI.
        // Deduplicate by bot/chat/minute so an unlinked chat cannot flood the outbox.
        const hash=await sha256(`${webhookId}:${telegramId}:${Math.floor(Date.now()/60000)}`);
        const source=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
        const {error}=await admin.from('chat_telegram_deliveries').upsert({user_id:account.user_id,bot_id:account.bot_id,
          telegram_id:telegramId,kind:'notice',source_id:source,body:text},{onConflict:'user_id,kind,source_id,part',ignoreDuplicates:true});
        if(error)throw new Error('Setup notice unavailable');
        kick();
      };
      const parsed=updateSchema.safeParse(await readBody(req));
      if(!parsed.success){await mark('unsupported_update');return respond();}
      const message=parsed.data.message;
      if(!message || message.chat.type!=="private" || message.from.is_bot || message.from.id!==message.chat.id || !message.text){await mark('private_text_required');return respond();}
      const text=message.text.trim();
      const match=/^\/start ([a-f0-9]{64})$/.exec(text);
      if(match) {
        const hash=await sha256(match[1]);
        if(!account.link_hash || hash!==account.link_hash || Date.parse(account.link_expires_at??"")<=Date.now()){
          await mark('link_expired');
          await notice(message.from.id,'Este enlace de vinculación ya no es válido. Genera otro en la web de Relámpago y abre el enlace completo.');
          return respond();
        }
        const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
        const {data:prepared,error:linkError}=await admin.rpc("chat_telegram_prepare_link",{
          p_webhook_id:webhookId,p_link_hash:hash,p_telegram_id:message.from.id,
          p_name:message.from.username?`@${message.from.username}`:(message.from.first_name??"Usuario de Telegram"),
          p_confirmation_hash:await sha256(`${account.user_id}:${hash}:${code}`),
          p_body:`Tu código de vinculación con Relámpago es: ${code}\nEscríbelo en la web para confirmar tu cuenta. Vence en 10 minutos. No lo compartas.`,
        });
        if(linkError) return respond(503);
        await mark(prepared?'code_queued':'link_already_pending');
        kick(); return respond();
      }
      if(!account.telegram_id || account.telegram_id!==message.from.id){
        const plainStart=/^\/start(?:@\w+)?$/.test(text);
        await mark(plainStart?'start_without_link':'unlinked_chat');
        await notice(message.from.id,'Para recibir tu código, abre Asistente IA → Telegram en la web de Relámpago, genera el enlace y ábrelo completo. Si Telegram no conserva el enlace, copia el mensaje de vinculación que muestra la web y envíalo aquí. Escribir /start solo no vincula tu cuenta.');
        return respond();
      }
      if(account.blocked || !account.telegram_id || account.telegram_id!==message.from.id
        || message.date<Math.floor(Date.parse(account.linked_at??"")/1000)-2) return respond();
      const {count,error:countError}=await admin.from("chat_telegram_updates").select("id",{count:"exact",head:true})
        .eq("user_id",account.user_id).gte("created_at",new Date(Date.now()-60000).toISOString());
      if(countError) return respond(503);
      if((count??0)>=12) return respond();
      const {error:queueError}=await admin.from("chat_telegram_updates").upsert({user_id:account.user_id,bot_id:account.bot_id,
        update_id:parsed.data.update_id,telegram_id:message.from.id,content:text||"/help"},
        {onConflict:"user_id,bot_id,update_id",ignoreDuplicates:true});
      if(queueError) return respond(503);
      await mark('message_queued');
      kick(); return respond();
    } catch { return respond(400); }
  };
}
