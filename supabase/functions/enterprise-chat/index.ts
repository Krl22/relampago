import { createHandler } from "./handler.ts";

Deno.serve(createHandler({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  encryptionKey: Deno.env.get("CHATBOT_ENCRYPTION_KEY") ?? "",
  workerSecret: Deno.env.get("CHATBOT_WORKER_SECRET") ?? "",
  origins: (Deno.env.get("CHATBOT_ALLOWED_ORIGINS") ?? "http://localhost:5173")
    .split(",").map(origin => origin.trim()).filter(Boolean),
}));
