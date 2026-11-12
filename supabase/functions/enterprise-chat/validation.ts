import { z } from "npm:zod@4.3.6";
export const telegramToken = z.string().trim().regex(/^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{20,100}$/);

export const providerSchema = z.enum(["openai", "anthropic", "deepseek", "openrouter"]);
export type Provider = z.infer<typeof providerSchema>;
const uuid = z.uuid();
export const reportArgs=z.object({dataset:z.enum(['orders','notes','activity']),format:z.enum(['xlsx','docx','pdf']),
  from:z.iso.date().nullable(),to:z.iso.date().nullable(),
  status:z.enum(['pending','picked_up','in_transit','delivered','failed','cancelled']).nullable(),actor_id:uuid.nullable()}).strict()
  .refine(v=>(!v.from||!v.to||(v.to>=v.from&&Date.parse(v.to)-Date.parse(v.from)<=365*86400000))
    &&(v.dataset!=='orders'||(v.from!==null&&v.to!==null&&v.actor_id===null))
    &&(v.dataset==='orders'||v.status===null)&&(v.dataset==='activity'||v.actor_id===null));
export type ReportArgs=z.infer<typeof reportArgs>;
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bootstrap") }).strict(),
  z.object({ action: z.literal("due_notes") }).strict(),
  z.object({action:z.literal('usage_summary'),from:z.iso.date(),to:z.iso.date(),provider:providerSchema.nullable(),conversation_id:uuid.nullable()}).strict()
    .refine(v=>v.to>=v.from&&Date.parse(v.to)-Date.parse(v.from)<=365*86400000),
  z.object({ action:z.literal('download_report'),report_id:uuid }).strict(),
  z.object({ action: z.literal("telegram_status") }).strict(),
  z.object({ action: z.literal("telegram_connect"), token: telegramToken }).strict(),
  z.object({ action: z.literal("telegram_link") }).strict(),
  z.object({ action: z.literal("telegram_confirm"),code:z.string().regex(/^[0-9]{6}$/) }).strict(),
  z.object({ action: z.literal("telegram_disconnect") }).strict(),
  z.object({ action: z.literal("telegram_reminders"),enabled:z.boolean() }).strict(),
  z.object({ action: z.literal("telegram_preferences"),provider:providerSchema,
    model:z.string().min(1).max(150).regex(/^[a-zA-Z0-9._:/-]+$/),conversation_id:uuid.nullable(),reminders_enabled:z.boolean() }).strict(),
  z.object({ action: z.literal("models"), provider: providerSchema }).strict(),
  z.object({ action: z.literal("save_key"), provider: providerSchema,
    key: z.string().trim().min(10).max(4096).regex(/^[\x21-\x7E]+$/) }).strict(),
  z.object({ action: z.literal("delete_key"), provider: providerSchema }).strict(),
  z.object({ action: z.literal("create_conversation") }).strict(),
  z.object({ action: z.literal("messages"), conversation_id: uuid,
    before: z.iso.datetime({ offset: true }).optional(), before_id: uuid.optional() }).strict()
    .refine(v => Boolean(v.before) === Boolean(v.before_id)),
  z.object({ action: z.literal("delete_conversation"), conversation_id: uuid }).strict(),
  z.object({ action: z.literal("send"), conversation_id: uuid, request_id: uuid,
    provider: providerSchema, model: z.string().min(1).max(150).regex(/^[a-zA-Z0-9._:/-]+$/),
    content: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ action: z.literal("save_note"), body: z.string().trim().min(1).max(4000),
    remind_at: z.iso.datetime({ offset: true }).nullable() }).strict(),
  z.object({ action: z.literal("complete_note"), note_id: uuid }).strict(),
  z.object({ action: z.literal("delete_note"), note_id: uuid }).strict(),
]);

export const orderArgs = z.object({
  from: z.iso.date(), to: z.iso.date(),
  status: z.enum(["pending", "picked_up", "in_transit", "delivered", "failed", "cancelled"]).nullable(),
}).strict().refine(v => v.to >= v.from && Date.parse(v.to) - Date.parse(v.from) <= 30 * 86400000,
  "El intervalo máximo es de 31 días.");
export const noArgs = z.object({}).strict();
export const findUserArgs = z.object({query:z.string().trim().min(2).max(100).nullable(),
  role:z.enum(['admin','staff','courier','client']).nullable()}).strict();
export const activityArgs = z.object({user_id:z.uuid().nullable(),from:z.iso.date().nullable(),to:z.iso.date().nullable()}).strict()
  .refine(v=>!v.from||!v.to||(v.to>=v.from&&Date.parse(v.to)-Date.parse(v.from)<=365*86400000));

export class ChatError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
