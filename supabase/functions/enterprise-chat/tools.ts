import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import { ChatError, noArgs, orderArgs,findUserArgs,activityArgs } from "./validation.ts";
import type { Tool } from "./providers.ts";
import {createReport,reportTool,type ReportContext} from './reports.ts';

export interface Profile { id: string; role: "admin" | "staff" | "courier" | "client"; company_id: string | null }
export const tools: Tool[] = [
  reportTool,
  { name: "list_orders", description: "Consulta de solo lectura de pedidos permitidos, por fecha programada. Máximo 31 días. Devuelve hasta 50 pedidos y el total exacto; no usar la muestra para calcular totales.",
    parameters: { type: "object", additionalProperties: false, properties: {
      from: { type: "string", description: "Fecha inicial YYYY-MM-DD" },
      to: { type: "string", description: "Fecha final YYYY-MM-DD" },
      status: { type: ["string", "null"], enum: ["pending", "picked_up", "in_transit", "delivered", "failed", "cancelled", null] },
    }, required: ["from", "to", "status"] } },
  { name: "order_summary", description: "Totales exactos de pedidos permitidos agrupados por estado en un intervalo de hasta 31 días, por fecha programada.",
    parameters: { type: "object", additionalProperties: false, properties: {
      from: { type: "string" }, to: { type: "string" },
      status: { type: ["string", "null"], enum: ["pending", "picked_up", "in_transit", "delivered", "failed", "cancelled", null] },
    }, required: ["from", "to", "status"] } },
  { name: "list_notes", description: "Lee una muestra de hasta 20 notas y recordatorios personales pendientes. Cada nota se limita a 1000 caracteres. No crea ni modifica recordatorios.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } },
];

const activityTools:Tool[]=[
  {name:"find_users",description:"Solo admin/staff: identifica cuentas por nombre y/o rol para consultar actividad. No hay atributo de dueño; no asumir quién lo es. Devuelve hasta 20 nombres, roles e IDs, sin correos ni secretos.",
    parameters:{type:"object",additionalProperties:false,properties:{query:{type:["string","null"],description:"Nombre parcial, mínimo 2 caracteres; null para listar por rol."},
      role:{type:["string","null"],enum:["admin","staff","courier","client",null]}},required:["query","role"]}},
  {name:"user_activity",description:"Solo admin/staff: última actividad REGISTRADA y hasta 50 eventos de pedidos, con usuario, fecha y acción. Consulta created_at del evento, no fecha programada. Con fechas null devuelve los eventos más recientes de todo el historial. Solo cubre creación, cambios de estado y asignación; NO toda edición de la base ni sesiones. Usa find_users si necesitas identificar una cuenta; no adivines quién es el dueño.",
    parameters:{type:"object",additionalProperties:false,properties:{user_id:{type:["string","null"],description:"UUID de la cuenta, o null para actividad de todas las cuentas permitidas."},
      from:{type:["string","null"],description:"Fecha inicial YYYY-MM-DD en Lima o null."},to:{type:["string","null"],description:"Fecha final YYYY-MM-DD en Lima o null. Hasta 366 fechas si se indican ambas."}},required:["user_id","from","to"]}},
];

export function toolsForProfile(profile:Profile):Tool[]{
  return ['admin','staff'].includes(profile.role)?[...tools,...activityTools]:tools;
}

export function makeToolExecutor(caller: SupabaseClient, profile: Profile, verifiedTelegram = false,reportContext?:ReportContext) {
  return async (name: string, args: unknown) => {
    if(name==='create_report'){
      if(!reportContext||reportContext.userId!==profile.id)throw new ChatError(400,'La generación de archivos requiere una consulta de chat activa.');
      return createReport(reportContext,args);
    }
    if(name==='find_users'||name==='user_activity'){
      if(!['admin','staff'].includes(profile.role))throw new ChatError(403,'No tienes permiso para consultar la actividad de usuarios.');
      const params=name==='find_users'?(()=>{const value=findUserArgs.parse(args);return {p_query:value.query,p_role:value.role}})()
        :(()=>{const value=activityArgs.parse(args);return {p_actor_id:value.user_id,p_from:value.from,p_to:value.to}})();
      const {data,error}=await caller.rpc(name==='find_users'?'chat_find_users':'chat_user_activity',{
        ...params,...(verifiedTelegram?{p_viewer_id:profile.id}:{}),
      });
      if(error)throw new ChatError(error.code==='42501'?403:500,'No se pudo consultar la actividad registrada con tus permisos.');
      return data;
    }
    if (name === "list_notes") {
      noArgs.parse(args);
      const { data, error, count } = await caller.from("chat_notes").select("id,body,remind_at,created_at", { count: "exact" })
        .eq("user_id", profile.id).eq("completed", false).order("remind_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw new ChatError(500, "No se pudieron consultar las notas.");
      return { notes: (data ?? []).map(note => ({ ...note, body: note.body.slice(0, 1000), body_truncated: note.body.length > 1000 })),
        total: count, limit: 20, truncated: (count ?? 0) > 20 };
    }
    if (name !== "list_orders" && name !== "order_summary") throw new ChatError(400, "Herramienta no permitida.");
    const filters = orderArgs.parse(args);
    if (name === "order_summary") {
      const { data, error } = await caller.rpc(verifiedTelegram ? "chat_service_order_summary" : "chat_order_summary", {
        p_from: filters.from, p_to: filters.to, p_status: filters.status,
        ...(verifiedTelegram ? { p_user_id: profile.id } : {}),
      });
      if (error) throw new ChatError(500, "No se pudo consultar el resumen de pedidos.");
      return { from: filters.from, to: filters.to, date_field: "scheduled_date", totals: data };
    }
    // Use the caller's JWT (RLS), plus explicit company/courier scope as defense in depth.
    // Only approved columns: no addresses, phones, DNI, keys, or arbitrary SELECT strings.
    let query = caller.from("orders")
      .select("id,order_number,status,scheduled_date,destination_district,packages_count", { count: "exact" })
      .gte("scheduled_date", filters.from).lte("scheduled_date", filters.to);
    if (profile.role === "client") {
      if (!profile.company_id) throw new ChatError(403, "No tienes un comercio vinculado.");
      query = query.eq("company_id", profile.company_id);
    } else if (profile.role === "courier") query = query.eq("assigned_courier", profile.id);
    if (filters.status) query = query.eq("status", filters.status);
    const { data, error, count } = await query.order("scheduled_date", { ascending: false }).order("id").limit(50);
    if (error) throw new ChatError(500, "No se pudieron consultar los pedidos.");
    return { orders: data, total: count, limit: 50, date_field: "scheduled_date", truncated: (count ?? 0) > 50 };
  };
}
