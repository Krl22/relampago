import { ChatError,telegramToken } from "./validation.ts";
export class TelegramError extends Error {
  constructor(public code: number, public retryAfter = 0, public uncertain = false) {
    super(code===429 ? "Telegram alcanzó su límite temporal. Inténtalo más tarde." : "Telegram no pudo completar la solicitud.");
  }
}
export async function telegramApi(token: string, method: "getMe"|"getWebhookInfo"|"setWebhook"|"deleteWebhook"|"sendMessage"|'sendDocument', body: Record<string,unknown>|FormData = {}) {
  telegramToken.parse(token);
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`,{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(12000),
      headers:body instanceof FormData?{}:{"Content-Type":"application/json"},body:body instanceof FormData?body:JSON.stringify(body),
    });
  } catch { throw new TelegramError(0,0,method==="sendMessage"||method==='sendDocument'); }
  // Never expose/log fetch errors (the Telegram URL contains its token).
  if (Number(response.headers.get("content-length"))>100000) { await response.body?.cancel(); throw new TelegramError(502); }
  const payload = await response.json().catch(()=>null);
  if (!payload || !payload.ok) throw new TelegramError(payload?.error_code??response.status,
    Math.min(Math.max(Number(payload?.parameters?.retry_after)||60,1),3600),
    (method==="sendMessage"||method==='sendDocument') && (response.status>=500 || !payload));
  return payload.result;
}
export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
export function randomSecret() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,"0")).join("");
}
export function equalSecret(a: string,b: string) {
  if (a.length!==b.length) return false;
  let difference=0;
  for(let i=0;i<a.length;i++) difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
export function splitTelegramText(text: string) {
  const parts: string[]=[];
  while(text.length) {
    let end=Math.min(3500,text.length);
    if (end<text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end--;
    parts.push(text.slice(0,end)); text=text.slice(end);
  }
  return parts;
}
export const safeTelegramError = (error: unknown): Error => error instanceof TelegramError
  ? new ChatError(error.code===429?429:400,error.code===401?"El token de Telegram no es válido.":error.message)
  : error instanceof ChatError ? error : new ChatError(500,"No se pudo configurar Telegram.");
