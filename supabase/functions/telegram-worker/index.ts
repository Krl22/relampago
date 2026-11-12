import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { createTelegramWorker } from "../enterprise-chat/telegram-worker.ts";

const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{
  auth:{persistSession:false,autoRefreshToken:false},
});
Deno.serve(createTelegramWorker(admin,Deno.env.get("CHATBOT_ENCRYPTION_KEY")??"",Deno.env.get("CHATBOT_WORKER_SECRET")??""));
