import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import { z } from "npm:zod@4.3.6";
import { decryptKey } from "./crypto.ts";
import { runTurn } from "./engine.ts";
import { ChatError } from "./validation.ts";
import { makeToolExecutor,toolsForProfile } from "./tools.ts";
import { equalSecret,splitTelegramText,telegramApi,TelegramError } from "./telegram-api.ts";
import type { TelegramAccount } from "./telegram-webhook.ts";
import {authorizeReport,cleanupReports} from './reports.ts';
import {REPORT_BUCKET} from './report-model.ts';

const profileSchema=z.object({id:z.uuid(),role:z.enum(["admin","staff","courier","client"]),company_id:z.uuid().nullable()});
async function authorizedProfile(admin:SupabaseClient,userId:string) {
  const [{data:{user},error:authError},{data,error}]=await Promise.all([
    admin.auth.admin.getUserById(userId),admin.from("profiles").select("id,role,company_id").eq("id",userId).maybeSingle(),
  ]);
  const parsed=profileSchema.safeParse(data);
  if(authError || error || !user || user.is_anonymous || user.app_metadata?.merchant_activation_required===true
    || (user.banned_until && Date.parse(user.banned_until)>Date.now()) || !parsed.success
    || parsed.data.role!=="admin") throw new ChatError(403,"El Asistente IA está disponible únicamente para administradores.");
  return parsed.data;
}
async function enqueueReply(admin:SupabaseClient,account:TelegramAccount,sourceId:string,text:string) {
  const rows=splitTelegramText(text).map((body,part)=>({user_id:account.user_id,bot_id:account.bot_id,
    telegram_id:account.telegram_id,kind:"reply",source_id:sourceId,part,body}));
  const {error}=await admin.from("chat_telegram_deliveries").upsert(rows,{onConflict:"user_id,kind,source_id,part",ignoreDuplicates:true});
  if(error) throw new Error("Could not enqueue reply");
}

export async function processTelegramUpdate(admin:SupabaseClient,master:string) {
  const {data:jobs,error}=await admin.rpc("chat_telegram_claim_update");
  if(error) throw new Error("Queue unavailable");
  const job=jobs?.[0];
  if(!job) return;
  const {data:rawAccount,error:accountError}=await admin.from("chat_telegram_accounts").select("*").eq("user_id",job.user_id).maybeSingle();
  if(accountError) throw new Error("Connection lookup unavailable");
  const account=rawAccount as TelegramAccount|null;
  if(!account || account.blocked || account.bot_id!==job.bot_id || account.telegram_id!==job.telegram_id) {
    await admin.from("chat_telegram_updates").update({status:"failed"}).eq("id",job.id); return;
  }
  let answer:string;
  try {
    const initialProfile=await authorizedProfile(admin,job.user_id);
    if(/^\/(start|help)(?:@\w+)?$/.test(job.content)) answer="Soy tu asistente de Relámpago. Pregúntame por tus pedidos o notas. /nuevo inicia otra conversación; /modelo muestra la configuración actual. El modelo y los avisos se configuran en la web, en Asistente IA → Telegram.";
    else if(job.content==="/modelo") answer=`Proveedor: ${account.provider}\nModelo: ${account.model??"Sin configurar"}\nPuedes cambiarlo en la web.`;
    else if(job.content==="/nuevo") {
      const {data,error}=await admin.from("chat_conversations").insert({user_id:account.user_id,title:"Telegram"}).select("id").single();
      if(error || !data) throw new Error("Conversation unavailable");
      const {error:saveError}=await admin.from("chat_telegram_accounts").update({conversation_id:data.id}).eq("user_id",account.user_id);
      if(saveError) throw new Error("Conversation unavailable");
      answer="Nueva conversación creada. También la encontrarás en la web.";
    } else {
      if(!account.model) throw new ChatError(400,"Elige proveedor y modelo en la web, en Asistente IA → Telegram.");
      let conversation=account.conversation_id;
      if(!conversation) {
        const {data,error}=await admin.from("chat_conversations").insert({user_id:account.user_id,title:"Telegram"}).select("id").single();
        if(error || !data) throw new Error("Conversation unavailable");
        conversation=data.id;
        const {error:saveError}=await admin.from("chat_telegram_accounts").update({conversation_id:conversation}).eq("user_id",account.user_id);
        if(saveError) throw new Error("Conversation unavailable");
      }
      const result=await runTurn(admin,admin,job.user_id,master,{conversation_id:conversation!,request_id:job.id,
        provider:account.provider,model:account.model,content:job.content},async(name,args)=>{
          // Re-read current role/company and account state for EVERY tool invocation.
          const profile=await authorizedProfile(admin,job.user_id);
          return makeToolExecutor(admin,profile,true,{admin,reader:admin,userId:job.user_id,
            conversationId:conversation!,requestId:job.id,telegram:true})(name,args);
        },toolsForProfile(initialProfile),'telegram');
      answer=result.text;
    }
  } catch(error) {
    if(error instanceof ChatError && error.status===403) {
      await admin.from("chat_telegram_updates").update({status:"failed"}).eq("id",job.id); return;
    }
    if(error instanceof ChatError && (error.status===429 || (error.status===409 && error.message.startsWith("Ya hay"))) && job.attempts<4) {
      await admin.from("chat_telegram_updates").update({status:"queued",available_at:new Date(Date.now()+60000).toISOString()}).eq("id",job.id); return;
    }
    answer=error instanceof ChatError?error.message:"No se pudo completar la consulta. Revisa el historial en la web antes de volver a enviarla.";
  }
  // Never send stale/reassigned account data after a long model call.
  const {data:current}=await admin.from("chat_telegram_accounts").select("bot_id,telegram_id").eq("user_id",job.user_id).maybeSingle();
  if(current && current.bot_id===job.bot_id && current.telegram_id===job.telegram_id){
    await enqueueReply(admin,account,job.id,answer);
    const {data:files,error}=await admin.from('chat_reports').select('id,filename,row_count').eq('user_id',job.user_id).eq('request_id',job.id).eq('status','ready');
    if(error)throw new Error('Report delivery lookup unavailable');
    if(files?.length){
      const {error}=await admin.from('chat_telegram_deliveries').upsert(files.map(file=>({user_id:job.user_id,bot_id:account.bot_id,
        telegram_id:job.telegram_id,kind:'document',source_id:file.id,report_id:file.id,body:`${file.filename} · ${file.row_count} registros` })),
        {onConflict:'user_id,kind,source_id,part',ignoreDuplicates:true});
      if(error)throw new Error('Report delivery queue unavailable');
    }
  }
  await admin.from("chat_telegram_updates").update({status:"completed"}).eq("id",job.id);
}

export async function dispatchTelegramDeliveries(admin:SupabaseClient,master:string,limit=5) {
  for(let i=0;i<limit;i++) {
    const {data,error}=await admin.rpc("chat_telegram_claim_delivery");
    if(error) throw new Error("Delivery queue unavailable");
    const item=data?.[0]; if(!item) return;
    const finish=async(status:string,extra:Record<string,unknown>={})=>{
      const {error}=await admin.from("chat_telegram_deliveries").update({status,...extra}).eq("id",item.id).eq("status","sending");
      if(error) throw new Error("Delivery outcome unavailable");
    };
    try {
      const {data:a,error}=await admin.from("chat_telegram_accounts").select("*").eq("user_id",item.user_id).maybeSingle();
      if(error) throw new Error("Connection lookup unavailable");
      if(!a || a.bot_id!==item.bot_id || a.blocked || (!['link','notice'].includes(item.kind) && a.telegram_id!==item.telegram_id)) {await finish("skipped");continue;}
      await authorizedProfile(admin,item.user_id);
      if(item.kind==="link" && (a.pending_telegram_id!==item.telegram_id || !a.link_expires_at || Date.parse(a.link_expires_at)<=Date.now())) {await finish("skipped");continue;}
      if(item.kind==="reminder") {
        const {data:note,error}=await admin.from("chat_notes").select("completed,remind_at").eq("id",item.note_id).eq("user_id",item.user_id).maybeSingle();
        if(error) throw new Error("Note lookup unavailable");
        if(!a.reminders_enabled || !note || note.completed || !note.remind_at || Date.parse(note.remind_at)>Date.now()) {await finish("skipped");continue;}
      }
      const token=await decryptKey(a.encrypted_token,item.user_id,"telegram",master);
      if(item.kind==='document'){
        if(!item.report_id){await finish('skipped');continue;}
        let report;
        try{report=await authorizeReport(admin,item.user_id,item.report_id,true);}catch{await finish('skipped');continue;}
        const {data:blob,error}=await admin.storage.from(REPORT_BUCKET).download(report.storage_path);
        if(error||!blob)throw new Error('Report file unavailable');
        const form=new FormData();form.set('chat_id',String(item.telegram_id));form.set('caption',item.body);
        form.set('document',blob,report.filename);form.set('protect_content','false');
        await telegramApi(token,'sendDocument',form);
      }else await telegramApi(token,"sendMessage",{chat_id:item.telegram_id,text:item.body,protect_content:true});
      await finish("sent",{sent_at:new Date().toISOString()});
      await admin.from("chat_telegram_accounts").update({last_delivery_error:null}).eq("user_id",item.user_id);
    } catch(error) {
      if(error instanceof ChatError && error.status===403) {await finish("skipped");continue;}
      if(error instanceof TelegramError && error.code===429 && item.attempts<5) {
        await finish("pending",{available_at:new Date(Date.now()+error.retryAfter*1000).toISOString()});
      } else {
        const uncertain=!(error instanceof TelegramError) || error.uncertain;
        await finish(uncertain?"uncertain":"failed");
        await admin.from("chat_telegram_accounts").update({
          last_delivery_error:uncertain?"No se confirmó una entrega. No se reenvió para evitar duplicados.":"Telegram rechazó una entrega. Revisa el bot y su vinculación.",
          ...(error instanceof TelegramError && [401,403].includes(error.code)?{blocked:true}:{}),
        }).eq("user_id",item.user_id);
      }
    }
  }
}

export async function telegramWork(admin:SupabaseClient,master:string,scheduled=true) {
  if(scheduled) {
    await cleanupReports(admin);
    const {error}=await admin.rpc("chat_telegram_enqueue_reminders"); if(error) throw new Error("Reminder queue unavailable");
    await admin.from("chat_telegram_deliveries").update({status:"uncertain"}).eq("status","sending").lt("started_at",new Date(Date.now()-180000).toISOString());
  }
  // Dispatch linking codes first so a slow AI request doesn't delay initial setup.
  await dispatchTelegramDeliveries(admin,master,2);
  await processTelegramUpdate(admin,master);
  await dispatchTelegramDeliveries(admin,master,2);
}

export function createTelegramWorker(admin:SupabaseClient,master:string,secret:string) {
  return async(req:Request)=>{
    if(req.method!=="POST") return new Response(null,{status:405});
    const supplied=req.headers.get("X-Chatbot-Worker-Secret")??"";
    if(!secret || !equalSecret(supplied,secret)) return new Response(null,{status:401});
    try {await telegramWork(admin,master);return Response.json({ok:true});}
    catch {return Response.json({error:"No se pudo procesar la cola."},{status:503});}
  };
}
