import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import type { z } from "npm:zod@4.3.6";
import { encryptKey,decryptKey } from "./crypto.ts";
import { ChatError,requestSchema } from "./validation.ts";
import { telegramApi,randomSecret,sha256,safeTelegramError } from "./telegram-api.ts";
import { providers } from "./providers.ts";

type Action = z.infer<typeof requestSchema>;
export async function telegramSettings(admin: SupabaseClient,userId: string,master: string,url: string,body: Action,schedulerReady: boolean) {
  if (!body.action.startsWith("telegram_")) return null;
  const {data:account,error:lookupError}=await admin.from("chat_telegram_accounts").select("*").eq("user_id",userId).maybeSingle();
  if (lookupError) throw new ChatError(500,"No se pudo consultar Telegram.");
  if(body.action==="telegram_status") return {connection:account?{
    bot_username:account.bot_username,linked:Boolean(account.telegram_id),pending:Boolean(account.pending_telegram_id),
    telegram_name:account.telegram_name??account.pending_name,reminders_enabled:account.reminders_enabled,
    provider:account.provider,model:account.model,conversation_id:account.conversation_id,blocked:account.blocked,
    last_delivery_error:account.last_delivery_error,
    last_webhook_at:account.last_webhook_at,last_webhook_state:account.last_webhook_state,
  }:null,scheduler_ready:schedulerReady};
  if (!master) throw new ChatError(503,"Falta configurar el cifrado del asistente en el servidor.");
  try {
    if(body.action==="telegram_connect") {
      const me=await telegramApi(body.token,"getMe");
      if(!me.is_bot || !Number.isSafeInteger(me.id) || !/^[A-Za-z0-9_]{5,32}$/.test(me.username??"")) throw new ChatError(400,"Telegram no devolvió un bot válido.");
      const {data:other,error:otherError}=await admin.from("chat_telegram_accounts").select("user_id").eq("bot_id",me.id).maybeSingle();
      if(otherError) throw new ChatError(500,"No se pudo verificar el bot.");
      if(other && other.user_id!==userId) throw new ChatError(409,"Este bot ya está vinculado a otra cuenta.");
      if(account && account.bot_id!==me.id) throw new ChatError(409,"Desconecta el bot actual antes de cambiarlo.");
      const info=await telegramApi(body.token,"getWebhookInfo");
      const webhookId=account?.webhook_id??crypto.randomUUID();
      const webhookUrl=`${url}/functions/v1/telegram-webhook/${webhookId}`;
      if(info.url && info.url!==webhookUrl) throw new ChatError(409,"Este bot ya está conectado a otra aplicación. Usa uno nuevo o desconéctalo allí primero.");
      const secret=randomSecret();
      const {error}=await admin.from("chat_telegram_accounts").upsert({user_id:userId,bot_id:me.id,bot_username:me.username,
        encrypted_token:await encryptKey(body.token,userId,"telegram",master),webhook_id:webhookId,
        webhook_secret_hash:await sha256(secret),blocked:false,updated_at:new Date().toISOString()});
      if(error) throw new ChatError(500,"No se pudo guardar la conexión de Telegram.");
      await telegramApi(body.token,"setWebhook",{url:webhookUrl,secret_token:secret,allowed_updates:["message"],max_connections:4});
      return {ok:true};
    }
    if(!account) throw new ChatError(400,"Conecta tu bot de Telegram primero.");
    if(body.action==="telegram_link") {
      const nonce=randomSecret();
      const {error}=await admin.from("chat_telegram_accounts").update({link_hash:await sha256(nonce),
        link_expires_at:new Date(Date.now()+600000).toISOString(),pending_telegram_id:null,pending_name:null,
        confirmation_hash:null,confirmation_attempts:0}).eq("user_id",userId);
      if(error) throw new ChatError(500,"No se pudo preparar la vinculación.");
      return {url:`https://t.me/${account.bot_username}?start=${nonce}`,expires_in:600};
    }
    if(body.action==="telegram_confirm") {
      if(!account.link_hash) throw new ChatError(400,"Genera un nuevo enlace de vinculación.");
      const {data,error}=await admin.rpc("chat_telegram_confirm",{p_user_id:userId,p_hash:await sha256(`${userId}:${account.link_hash}:${body.code}`)});
      if(error || !data) throw new ChatError(400,"Código incorrecto o vencido. Hay un máximo de 5 intentos; después genera otro enlace.");
      return {ok:true};
    }
    if(body.action==="telegram_disconnect") {
      // Revoke local access first. Old/retried webhook requests become harmless immediately.
      const {error}=await admin.from("chat_telegram_accounts").delete().eq("user_id",userId);
      if(error) throw new ChatError(500,"No se pudo desconectar Telegram.");
      try { await telegramApi(await decryptKey(account.encrypted_token,userId,"telegram",master),"deleteWebhook"); } catch { /* Local revocation is already effective, even if token was revoked. */ }
      return {ok:true};
    }
    if(body.action==="telegram_preferences") {
      const {data:credential,error:keyError}=await admin.from("chat_credentials").select("encrypted_key").eq("user_id",userId).eq("provider",body.provider).maybeSingle();
      if(keyError || !credential) throw new ChatError(400,"Conecta tu clave de IA para este proveedor primero.");
      const models=await providers[body.provider].listModels(await decryptKey(credential.encrypted_key,userId,body.provider,master),AbortSignal.timeout(15000));
      if(!models.some(model=>model.id===body.model)) throw new ChatError(400,"Elige un modelo disponible para tu clave.");
      let conversation=body.conversation_id??account.conversation_id;
      if(conversation) {
        const {data,error}=await admin.from("chat_conversations").select("id").eq("id",conversation).eq("user_id",userId).maybeSingle();
        if(error || !data) throw new ChatError(404,"Conversación no encontrada.");
      } else {
        const {data,error}=await admin.from("chat_conversations").insert({user_id:userId,title:"Telegram"}).select("id").single();
        if(error || !data) throw new ChatError(500,"No se pudo crear la conversación de Telegram.");
        conversation=data.id;
      }
      const {error}=await admin.from("chat_telegram_accounts").update({provider:body.provider,model:body.model,
        conversation_id:conversation,reminders_enabled:body.reminders_enabled,updated_at:new Date().toISOString()}).eq("user_id",userId);
      if(error) throw new ChatError(500,"No se pudo guardar la configuración de Telegram.");
      return {ok:true,conversation_id:conversation};
    }
    if(body.action==="telegram_reminders") {
      if(body.enabled && (!account.telegram_id || !schedulerReady)) throw new ChatError(400,"Vincula tu Telegram y activa el programador del servidor primero.");
      const {error}=await admin.from("chat_telegram_accounts").update({reminders_enabled:body.enabled}).eq("user_id",userId);
      if(error) throw new ChatError(500,"No se pudo guardar la preferencia de avisos.");
      return {ok:true};
    }
  } catch(error) { throw safeTelegramError(error); }
  throw new ChatError(400,"Acción de Telegram no permitida.");
}
