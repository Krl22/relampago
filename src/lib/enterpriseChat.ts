import { supabase } from './supabase'

export type ChatProvider = 'openai' | 'anthropic' | 'deepseek' | 'openrouter'
export const PROVIDER_NAMES: Record<ChatProvider, string> = { openai: 'OpenAI', anthropic: 'Claude · Anthropic', deepseek: 'DeepSeek', openrouter:'OpenRouter' }
export interface ChatModel { id: string; name: string }
export interface ChatCredential { provider: ChatProvider; updated_at: string }
export interface ChatConversation { id: string; title: string; updated_at: string }
export interface ChatMessage {
  id: string; conversation_id: string; role: 'user' | 'assistant'; content: string
  status: 'pending' | 'completed' | 'failed'; provider: ChatProvider; model: string; created_at: string
  reports?:ChatReport[]
}
export interface ChatReport{id:string;request_id:string;dataset:'orders'|'notes'|'activity';format:'xlsx'|'docx'|'pdf';filename:string;
  row_count:number;byte_size:number;created_at:string;expires_at:string}
export interface UsageGroup{calls:number;tokens:number;reported_usd:number;estimated_usd:number;unpriced_calls:number}
export interface ChatUsage{
 totals:{calls:number;queries:number;input_tokens:number;output_tokens:number;cached_tokens:number;reasoning_tokens:number;reported_usd:number;estimated_usd:number;unpriced_calls:number;unmetered_calls:number;unconfirmed_calls:number}
 models:(UsageGroup&{provider:ChatProvider;model:string})[]
 conversations:(UsageGroup&{conversation_id:string|null;title:string})[]
 recent:{id:string;provider:ChatProvider;model:string;channel:'web'|'telegram';step:number;state:string;input_tokens:number|null;output_tokens:number|null;cost_usd:number|null;cost_kind:'reported'|'estimated'|'unknown';price_note:string|null;price_verified_at:string|null;created_at:string}[]
 tracking_since:string|null;timezone:string
}
export interface ChatNote { id: string; body: string; remind_at: string | null; completed: boolean; created_at: string }
export interface ChatBootstrap {
  credentials: ChatCredential[]; conversations: ChatConversation[]; notes: ChatNote[]; encryption_ready: boolean
}
export interface TelegramStatus {
  connection: null | {bot_username:string;linked:boolean;pending:boolean;telegram_name:string|null;
    reminders_enabled:boolean;provider:ChatProvider;model:string|null;conversation_id:string|null;blocked:boolean;last_delivery_error:string|null
    last_webhook_at?:string|null;last_webhook_state?:string|null}
  scheduler_ready:boolean
}

type ChatAction =
  | {action:'usage_summary';from:string;to:string;provider:ChatProvider|null;conversation_id:string|null}
  | { action: 'bootstrap' | 'due_notes' | 'create_conversation' }
  | { action: 'models' | 'delete_key'; provider: ChatProvider }
  | { action: 'save_key'; provider: ChatProvider; key: string }
  | { action: 'messages'; conversation_id: string; before?: string; before_id?: string }
  | { action: 'delete_conversation'; conversation_id: string }
  | { action: 'send'; conversation_id: string; request_id: string; provider: ChatProvider; model: string; content: string }
  | { action: 'save_note'; body: string; remind_at: string | null }
  | { action: 'complete_note' | 'delete_note'; note_id: string }
  | { action:'download_report';report_id:string }
  | { action: 'telegram_status' | 'telegram_link' | 'telegram_disconnect' }
  | { action: 'telegram_connect';token:string }
  | { action: 'telegram_confirm';code:string }
  | { action: 'telegram_reminders';enabled:boolean }
  | { action: 'telegram_preferences';provider:ChatProvider;model:string;conversation_id:string|null;reminders_enabled:boolean }

export async function chatRequest<T = { ok: boolean }>(body: ChatAction): Promise<T> {
  // Provider keys are sent only in this authenticated POST, never URLs/storage/logs.
  const { data, error } = await supabase.functions.invoke('enterprise-chat', { body })
  if (error) {
    const response = (error as { context?: Response }).context
    const payload = response ? await response.json().catch(() => null) : null
    throw new Error(payload?.error ?? 'El asistente no está disponible. Comprueba la conexión y la configuración del servidor.')
  }
  return data as T
}

export function notesChanged() { window.dispatchEvent(new Event('relampago:chat-notes-changed')) }
