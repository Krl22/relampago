import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { createTelegramWebhook } from "../enterprise-chat/telegram-webhook.ts";
import { telegramWork } from "../enterprise-chat/telegram-worker.ts";

declare const EdgeRuntime:{waitUntil:(promise:Promise<unknown>)=>void};
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{
  auth:{persistSession:false,autoRefreshToken:false},
});
const master=Deno.env.get("CHATBOT_ENCRYPTION_KEY")??"";
Deno.serve(createTelegramWebhook(admin,()=>{
  EdgeRuntime.waitUntil(telegramWork(admin,master,false).catch(()=>{console.error("telegram_background_processing_failed");}));
}));
