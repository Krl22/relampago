import { useCallback,useEffect,useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '../ui/button'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '../ui/dialog'
import { chatRequest,PROVIDER_NAMES } from '../../lib/enterpriseChat'
import type { ChatProvider,TelegramStatus } from '../../lib/enterpriseChat'

export function TelegramSettings({provider,model,conversationId,onClose,onChanged}:{
  provider:ChatProvider;model:string;conversationId:string;onClose:()=>void;onChanged:()=>Promise<void>
}) {
  const [status,setStatus]=useState<TelegramStatus|null>(null)
  const [token,setToken]=useState('')
  const [code,setCode]=useState('')
  const [link,setLink]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [deleting,setDeleting]=useState(false)
  const refresh=useCallback(async()=>{
    const data=await chatRequest<TelegramStatus>({action:'telegram_status'});setStatus(data)
  },[])
  useEffect(()=>{
    let active=true
    chatRequest<TelegramStatus>({action:'telegram_status'}).then(data=>{if(active)setStatus(data)})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudo cargar Telegram.')})
    return()=>{active=false}
  },[])
  useEffect(()=>{
    if(!link) return
    const timer=window.setInterval(()=>{void refresh().catch(()=>{})},5000)
    return()=>window.clearInterval(timer)
  },[link,refresh])
  async function mutate(operation:()=>Promise<void>) {
    setBusy(true);setError('');setNotice('')
    try {await operation();await refresh()}
    catch(e){setError(e instanceof Error?e.message:'No se pudo configurar Telegram.')}
    finally{setBusy(false)}
  }
  const account=status?.connection
  const receipt:Record<string,string>={start_without_link:'Telegram recibió /start sin el enlace completo. Copia y envía el mensaje de vinculación que aparece abajo.',
    code_queued:'Solicitud recibida. El código está en la cola de envío; puede tardar hasta un minuto.',
    link_already_pending:'Ya se solicitó un código con este enlace. Revisa Telegram o genera otro enlace si no llega.',
    link_expired:'El enlace recibido venció o fue reemplazado. Genera uno nuevo.',
    unsupported_update:'Se recibió un mensaje que no se pudo reconocer.',private_text_required:'Para vincularte, envía el mensaje en un chat privado con el bot.',
    unlinked_chat:'Este chat aún no está vinculado. Abre el enlace completo o envía el mensaje de vinculación.',message_queued:'Telegram está recibiendo tus mensajes.'}
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose()}}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5"/>Tu bot de Telegram</DialogTitle>
        <DialogDescription>Habla con tu asistente y recibe recordatorios desde Telegram, incluso con la web cerrada.</DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <p className="text-sm text-slate-600">Crea tu bot con <a className="text-primary underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a> usando /newbot. Luego conecta aquí su token. Se guarda cifrado y no se vuelve a mostrar.</p>
        <form className="space-y-2" onSubmit={e=>{
          e.preventDefault();const submitted=token;setToken('')
          void mutate(async()=>{await chatRequest({action:'telegram_connect',token:submitted});setNotice('Bot conectado. Ahora vincula tu cuenta de Telegram.')})
        }}>
          <label className="block text-sm font-medium">Token del bot
            <input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" spellCheck={false}
              autoCapitalize="none" maxLength={150} required disabled={busy} className="mt-1 w-full rounded-md border p-2" placeholder="Token entregado por BotFather"/>
          </label>
          <Button size="sm" type="submit" disabled={busy||!token.trim()}>{account?'Actualizar token':'Conectar bot'}</Button>
        </form>
        {account&&<>
          <div className="rounded-lg border bg-slate-50 p-3 text-sm">
            <p className="font-semibold">@{account.bot_username}</p>
            <p className="mt-1">{account.linked?`Vinculado a ${account.telegram_name??'tu cuenta'}`:'Pendiente de vincular tu cuenta'}</p>
            {account.blocked&&<p className="mt-1 text-amber-800">Telegram bloqueó la entrega. Desbloquea el bot o actualiza su token y vuelve a vincularlo.</p>}
            {account.last_delivery_error&&<p className="mt-1 text-amber-800">{account.last_delivery_error}</p>}
            {!account.linked&&account.last_webhook_state&&receipt[account.last_webhook_state]&&<p className="mt-2 text-xs text-slate-600">{receipt[account.last_webhook_state]}</p>}
          </div>
          <div className="space-y-2 border-t pt-3">
            <h3 className="font-medium">Vincular tu Telegram</h3>
            <Button size="sm" variant="outline" disabled={busy} onClick={()=>void mutate(async()=>{
              const data=await chatRequest<{url:string}>({action:'telegram_link'});setLink(data.url);setCode('')
            })}>{link?'Generar otro enlace':'Generar enlace de vinculación'}</Button>
            {link&&<>
              <p className="text-sm"><a href={link} target="_blank" rel="noreferrer" className="font-medium text-primary underline">Abrir mi bot en Telegram</a></p>
              <p className="text-xs text-slate-600">Pulsa Iniciar en Telegram y escribe aquí el código de 6 dígitos que te envíe el bot. El enlace vence en 10 minutos.</p>
              <label className="block text-xs text-slate-600">Si no llega el código, copia este mensaje completo y envíalo al bot:
                <input aria-label="Mensaje de vinculación" readOnly value={`/start ${new URL(link).searchParams.get('start')??''}`}
                  onFocus={e=>e.currentTarget.select()} className="mt-1 w-full rounded-md border bg-slate-50 p-2 font-mono text-xs"/>
              </label>
              <Button type="button" size="sm" variant="outline" onClick={()=>{
                const command=`/start ${new URL(link).searchParams.get('start')??''}`
                void navigator.clipboard.writeText(command).then(()=>setNotice('Mensaje copiado. Pégalo y envíalo completo en el chat de tu bot de Telegram.'))
                  .catch(()=>setError('Selecciona el mensaje de vinculación y cópialo manualmente.'))
              }}>Copiar mensaje de vinculación</Button>
              <form className="flex items-end gap-2" onSubmit={e=>{
                e.preventDefault();void mutate(async()=>{
                  await chatRequest({action:'telegram_confirm',code});setCode('');setLink('');setNotice('Tu Telegram quedó vinculado. Ya puedes hablar con el asistente.')
                })
              }}>
                <label className="min-w-0 flex-1 text-sm">Código de Telegram
                  <input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code"
                    pattern="[0-9]{6}" required maxLength={6} disabled={busy} className="mt-1 w-full rounded-md border p-2"/>
                </label>
                <Button type="submit" size="sm" disabled={busy||code.length!==6}>Confirmar</Button>
              </form>
            </>}
          </div>
          <div className="space-y-2 border-t pt-3">
            <h3 className="font-medium">Modelo e historial compartidos</h3>
            <p className="text-sm text-slate-600">Actual: {account.model?`${PROVIDER_NAMES[account.provider]} · ${account.model}`:'Sin configurar'}</p>
            <p className="text-xs text-slate-600">Usa el proveedor, modelo y conversación seleccionados en el chat web. Si no hay conversación activa, se conserva o crea una para Telegram.</p>
            <Button size="sm" variant="outline" disabled={busy||!model} onClick={()=>void mutate(async()=>{
              await chatRequest({action:'telegram_preferences',provider,model,conversation_id:conversationId||null,reminders_enabled:account.reminders_enabled})
              await onChanged();setNotice('Telegram usará el modelo y la conversación seleccionados.')
            })}>Usar selección del chat web</Button>
            {!model&&<p className="text-xs text-amber-800">Conecta tu clave de IA y selecciona un modelo en el chat web primero.</p>}
          </div>
          <div className="space-y-2 border-t pt-3">
            <h3 className="font-medium">Recordatorios por Telegram</h3>
            <p className="text-xs text-slate-600">Envía tus notas con fecha al vencer. No necesitas mantener la web abierta. Los avisos no consumen tu API de IA.</p>
            <Button size="sm" variant={account.reminders_enabled?'default':'outline'} disabled={busy||!account.linked||!status?.scheduler_ready}
              onClick={()=>void mutate(async()=>{await chatRequest({action:'telegram_reminders',enabled:!account.reminders_enabled})})}>
              {account.reminders_enabled?'Desactivar avisos':'Activar avisos'}
            </Button>
            {!status?.scheduler_ready&&<p className="text-xs text-amber-800">El programador del servidor aún no está disponible.</p>}
          </div>
          <div className="border-t pt-3">
            {deleting?<div className="flex flex-wrap items-center gap-2 text-sm"><p>¿Desconectar el bot y detener sus avisos?</p>
              <Button size="sm" variant="destructive" disabled={busy} onClick={()=>void mutate(async()=>{
                await chatRequest({action:'telegram_disconnect'});setDeleting(false);setLink('');setNotice('Telegram desconectado. Tus conversaciones y notas se conservan.')
              })}>Desconectar</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>setDeleting(false)}>Cancelar</Button>
            </div>:<Button size="sm" variant="ghost" disabled={busy} onClick={()=>setDeleting(true)}>Desconectar Telegram</Button>}
          </div>
        </>}
        {busy&&<p role="status" className="text-sm text-slate-500">Procesando…</p>}
        {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
        {notice&&<p role="status" className="text-sm text-green-700">{notice}</p>}
        <p className="text-xs text-slate-500">Solo lectura y chats privados con la cuenta vinculada. El bot consulta pedidos y notas; no modifica datos de la empresa. Se aplican tus permisos de Relámpago y el consumo usa tu clave del proveedor de IA.</p>
      </div>
    </DialogContent>
  </Dialog>
}
