import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { z } from "npm:zod@4.3.6";
import { decryptKey, encryptKey } from "./crypto.ts";
import { providers } from "./providers.ts";
import { ChatError, requestSchema, type Provider } from "./validation.ts";
import { makeToolExecutor,toolsForProfile } from "./tools.ts";
import { runTurn } from "./engine.ts";
import { telegramSettings } from "./telegram-settings.ts";
import {downloadReport,reportMetadataColumns} from './reports.ts';

export interface Config { url: string; anonKey: string; serviceKey: string; encryptionKey: string; origins: string[]; workerSecret?: string }
const profileSchema = z.object({ id: z.uuid(), role: z.enum(["admin", "staff", "courier", "client"]), company_id: z.uuid().nullable() });
const messageColumns = "id,conversation_id,request_id,role,content,status,provider,model,created_at";

export async function readBody(req: Request) {
  if (!req.headers.get("content-type")?.includes("application/json")) throw new ChatError(415, "Envía un cuerpo JSON.");
  const reader = req.body?.getReader();
  if (!reader) throw new ChatError(400, "Falta la solicitud.");
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64000) throw new ChatError(413, "Solicitud demasiado grande.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel(); }
  try { return JSON.parse(text); } catch { throw new ChatError(400, "JSON inválido."); }
}

export function createHandler(config: Config) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      ...(origin && config.origins.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !config.origins.includes(origin)) return json(403, { error: "Origen no permitido." });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return json(405, { error: "Método no permitido." });
    try {
      const authorization = req.headers.get("Authorization") ?? "";
      if (!authorization.startsWith("Bearer ")) throw new ChatError(401, "Inicia sesión para usar el asistente.");
      const caller = createClient(config.url, config.anonKey, {
        global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
      });
      // Validate the actual session with Auth; never trust decoded JWT/user_metadata.
      const { data: { user }, error: authError } = await caller.auth.getUser();
      if (authError || !user) throw new ChatError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
      if (user.is_anonymous || user.app_metadata?.merchant_activation_required === true) throw new ChatError(403, "Activa tu cuenta antes de usar el asistente.");
      const { data: rawProfile, error: profileError } = await caller.from("profiles").select("id,role,company_id").eq("id", user.id).single();
      const parsedProfile = profileSchema.safeParse(rawProfile);
      if (profileError || !parsedProfile.success) throw new ChatError(403, "No tienes un perfil autorizado.");
      const profile = parsedProfile.data;
      if (profile.role !== "admin") throw new ChatError(403, "El Asistente IA está disponible únicamente para administradores.");
      const body = requestSchema.parse(await readBody(req));
      const admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const check = (error: unknown) => { if (error) throw new ChatError(500, "No se pudo guardar o consultar la información del asistente."); };
      const masterKey = () => {
        if (!config.encryptionKey) throw new ChatError(503, "Falta configurar el cifrado del asistente en el servidor.");
        return config.encryptionKey;
      };
      const loadKey = async (provider: Provider) => {
        const { data, error } = await admin.from("chat_credentials").select("encrypted_key").eq("user_id", user.id).eq("provider", provider).maybeSingle();
        check(error);
        if (!data) throw new ChatError(400, "Conecta tu clave de este proveedor en Configuración.");
        return await decryptKey(data.encrypted_key, user.id, provider, masterKey());
      };
      const ownsConversation = async (id: string) => {
        const { data, error } = await caller.from("chat_conversations").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
        check(error);
        if (!data) throw new ChatError(404, "Conversación no encontrada.");
      };
      if (body.action === "bootstrap") {
        const [credentials, conversations, notes] = await Promise.all([
          admin.from("chat_credentials").select("provider,updated_at").eq("user_id", user.id),
          caller.from("chat_conversations").select("id,title,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(100),
          caller.from("chat_notes").select("id,body,remind_at,completed,created_at").eq("user_id", user.id).eq("completed", false).order("remind_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(100),
        ]);
        check(credentials.error || conversations.error || notes.error);
        return json(200, { credentials: credentials.data, conversations: conversations.data, notes: notes.data,
          encryption_ready: Boolean(config.encryptionKey) });
      }
      if (body.action === "due_notes") {
        const { count, error } = await caller.from("chat_notes").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).eq("completed", false).lte("remind_at", new Date().toISOString());
        check(error); return json(200, { count: count ?? 0 });
      }
      if(body.action==='usage_summary'){
        const {data,error}=await caller.rpc('chat_usage_summary',{p_from:body.from,p_to:body.to,p_provider:body.provider,p_conversation_id:body.conversation_id});
        check(error);return json(200,data);
      }
      if (body.action === "save_key") {
        // Encrypt before provider validation; misconfigured encryption cannot save plaintext.
        const encrypted = await encryptKey(body.key, user.id, body.provider, masterKey());
        const models = await providers[body.provider].listModels(body.key, AbortSignal.timeout(15000));
        if (!models.length) throw new ChatError(400, "Esta clave no tiene modelos de chat disponibles.");
        const { error } = await admin.from("chat_credentials").upsert({ user_id: user.id, provider: body.provider,
          encrypted_key: encrypted, updated_at: new Date().toISOString() });
        check(error);
        return json(200, { ok: true, models });
      }
      if (body.action === "delete_key") {
        const { error } = await admin.from("chat_credentials").delete().eq("user_id", user.id).eq("provider", body.provider);
        check(error); return json(200, { ok: true });
      }
      if (body.action === "models") {
        return json(200, { models: await providers[body.provider].listModels(await loadKey(body.provider), AbortSignal.timeout(15000)) });
      }
      if(body.action==='download_report')return json(200,await downloadReport(admin,caller,user.id,body.report_id));
      if (body.action === "create_conversation") {
        const { data, error } = await caller.from("chat_conversations").insert({ user_id: user.id }).select("id,title,updated_at").single();
        check(error); return json(200, { conversation: data });
      }
      if (body.action === "messages") {
        await ownsConversation(body.conversation_id);
        let query = caller.from("chat_messages").select(messageColumns).eq("conversation_id", body.conversation_id).eq("user_id", user.id);
        if (body.before && body.before_id) query = query.or(`created_at.lt.${body.before},and(created_at.eq.${body.before},id.lt.${body.before_id})`);
        const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50);
        check(error);
        const ids=(data??[]).filter(message=>message.role==='assistant').map(message=>message.request_id);
        const reports=ids.length?await caller.from('chat_reports').select(reportMetadataColumns).eq('user_id',user.id)
          .eq('conversation_id',body.conversation_id).eq('status','ready').in('request_id',ids):{data:[],error:null};
        check(reports.error);
        return json(200, { messages: (data ?? []).reverse().map(message=>({...message,
          reports:message.role==='assistant'?(reports.data??[]).filter(report=>report.request_id===message.request_id):[]})), has_more: data?.length === 50 });
      }
      if (body.action === "delete_conversation") {
        await ownsConversation(body.conversation_id);
        const { error } = await caller.from("chat_conversations").delete().eq("id", body.conversation_id).eq("user_id", user.id);
        check(error); return json(200, { ok: true });
      }
      if (body.action === "save_note") {
        const { error } = await caller.from("chat_notes").insert({ user_id: user.id, body: body.body, remind_at: body.remind_at });
        check(error); return json(200, { ok: true });
      }
      if (body.action === "complete_note" || body.action === "delete_note") {
        const query = body.action === "complete_note" ? caller.from("chat_notes").update({ completed: true }) : caller.from("chat_notes").delete();
        const { error } = await query.eq("id", body.note_id).eq("user_id", user.id);
        check(error); return json(200, { ok: true });
      }
      if (body.action === "send") {
        const result = await runTurn(admin,caller,user.id,config.encryptionKey,body,makeToolExecutor(caller,profile,false,
          {admin,reader:caller,userId:user.id,conversationId:body.conversation_id,requestId:body.request_id,telegram:false}),toolsForProfile(profile));
        return json(200,{ok:true,cached:result.cached});
      }
      const telegramResult = await telegramSettings(admin,user.id,config.encryptionKey,config.url,body,Boolean(config.workerSecret));
      if (telegramResult) return json(200,telegramResult);
      throw new ChatError(400, "Acción no permitida.");
    } catch (error) {
      if (error instanceof ChatError) return json(error.status, { error: error.message });
      if (error instanceof z.ZodError) return json(400, { error: "La solicitud contiene campos inválidos." });
      if (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) return json(504, { error: "El proveedor tardó demasiado. Actualiza el historial antes de reintentar." });
      // Never log request bodies, keys, provider errors or tool results.
      return json(500, { error: "No se pudo completar la solicitud del asistente." });
    }
  };
}
