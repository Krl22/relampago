import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Bot, MessageSquare, Plus, Send, Settings2, Trash2 } from 'lucide-react'
import { useAuth } from '../components/AuthProvider'
import { Button } from '../components/ui/button'
import { ChatSettings } from '../components/chat/ChatSettings'
import { ChatNotes } from '../components/chat/ChatNotes'
import { TelegramSettings } from '../components/chat/TelegramSettings'
import { ReportAttachment } from '../components/chat/ReportAttachment'
import { ChatUsage } from '../components/chat/ChatUsage'
import { chatRequest, PROVIDER_NAMES } from '../lib/enterpriseChat'
import type { ChatBootstrap, ChatConversation, ChatMessage, ChatModel, ChatProvider } from '../lib/enterpriseChat'

export default function EnterpriseChat() {
  const { user } = useAuth()
  // Remount all private state when the session owner changes.
  return user ? <ChatWorkspace key={user.id} /> : null
}

function ChatWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams()
  const showNotes = searchParams.get('panel') === 'notas'
  const [snapshot, setSnapshot] = useState<ChatBootstrap | null>(null)
  const [selected, setSelected] = useState('')
  const [provider, setProvider] = useState<ChatProvider>('openai')
  const [models, setModels] = useState<ChatModel[]>([])
  const [model, setModel] = useState('')
  const [modelOwner, setModelOwner] = useState<ChatProvider | null>(null)
  const [keyRevision, setKeyRevision] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [settings, setSettings] = useState(false)
  const [telegramOpen,setTelegramOpen]=useState(false)
  const [usageOpen,setUsageOpen]=useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [modelError, setModelError] = useState('')
  const [connectionNotice,setConnectionNotice]=useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const messageRequest = useRef(0)
  const bottom = useRef<HTMLDivElement>(null)
  const connected = snapshot?.credentials.some(c => c.provider === provider) ?? false
  const modelReady = modelOwner === provider && models.some(m => m.id === model)

  const refresh = useCallback(async () => {
    const data = await chatRequest<ChatBootstrap>({ action: 'bootstrap' })
    setSnapshot(data)
    return data
  }, [])
  useEffect(() => {
    let active = true
    chatRequest<ChatBootstrap>({ action: 'bootstrap' }).then(data => {
      if (!active) return
      setSnapshot(data)
      if (data.credentials.length) setProvider(data.credentials[0].provider)
      setSelected(data.conversations[0]?.id ?? '')
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'No se pudo cargar el asistente.') })
      .finally(() => { if (active) setInitialLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!connected || modelOwner === provider) return
    let active = true
    chatRequest<{ models: ChatModel[] }>({ action: 'models', provider }).then(data => {
      if (!active) return
      setModels(data.models); setModelOwner(provider); setModelError('')
      setModel(current => data.models.some(m => m.id === current) ? current : data.models[0]?.id ?? '')
    }).catch(e => { if (active) { setModelOwner(null); setModelError(e instanceof Error ? e.message : 'No se pudieron cargar los modelos.') } })
    return () => { active = false }
  }, [provider, connected, keyRevision, modelOwner])
  useEffect(() => {
    if (!selected) return
    let active = true
    const ticket = ++messageRequest.current
    chatRequest<{ messages: ChatMessage[]; has_more: boolean }>({ action: 'messages', conversation_id: selected })
      .then(data => { if (active && ticket === messageRequest.current) { setMessages(data.messages); setHasMore(data.has_more) } })
      .catch(e => { if (active && ticket === messageRequest.current) setError(e instanceof Error ? e.message : 'No se pudo cargar el historial.') })
    return () => { active = false }
  }, [selected])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages, busy])

  async function loadMessages(id: string, older = false) {
    const ticket = ++messageRequest.current
    setLoadingMessages(true)
    try {
      const data = await chatRequest<{ messages: ChatMessage[]; has_more: boolean }>({
        action: 'messages', conversation_id: id, ...(older && messages.length ? { before: messages[0].created_at, before_id: messages[0].id } : {}),
      })
      if (ticket === messageRequest.current) {
        setMessages(current => older ? [...data.messages, ...current] : data.messages)
        setHasMore(data.has_more)
      }
    } finally { if (ticket === messageRequest.current) setLoadingMessages(false) }
  }
  const switchConversation = (id: string) => {
    messageRequest.current++; setSelected(id); setMessages([]); setHasMore(false); setError(''); setDeleting(false)
  }
  async function send() {
    if (busy || loadingMessages || !draft.trim() || !modelReady || !connected) return
    setBusy(true); setError('')
    let id = selected
    try {
      if (!id) {
        const { conversation } = await chatRequest<{ conversation: ChatConversation }>({ action: 'create_conversation' })
        id = conversation.id; setSelected(id)
      }
      await chatRequest({ action: 'send', conversation_id: id, request_id: crypto.randomUUID(), provider, model, content: draft })
      setDraft('')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar la consulta.') }
    finally {
      try { if (id) await loadMessages(id); await refresh() }
      catch { setError(current => current || 'Actualiza el historial para comprobar el resultado antes de reintentar.') }
      setBusy(false)
    }
  }
  async function removeConversation() {
    setBusy(true); setError('')
    try {
      await chatRequest({ action: 'delete_conversation', conversation_id: selected })
      switchConversation(''); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar la conversación.') }
    finally { setBusy(false); setDeleting(false) }
  }
  function connectedKey(nextProvider: ChatProvider, catalog: ChatModel[]) {
    setSnapshot(current=>current?{...current,credentials:[...current.credentials.filter(c=>c.provider!==nextProvider),
      {provider:nextProvider,updated_at:new Date().toISOString()}]}:current)
    setProvider(nextProvider);setModels(catalog);setModelOwner(nextProvider)
    setModel(current=>catalog.some(m=>m.id===current)?current:catalog[0]?.id??'')
    setModelError('');setError('')
    setConnectionNotice(`${PROVIDER_NAMES[nextProvider]} conectado. El chat ya está disponible.`)
  }
  function disconnectedKey(removed: ChatProvider) {
    setSnapshot(current=>current?{...current,credentials:current.credentials.filter(c=>c.provider!==removed)}:current)
    if(removed===provider){setModels([]);setModel('');setModelOwner(null)}
    setConnectionNotice('')
  }
  return <div data-page="assistant" className="mx-auto max-w-7xl space-y-4">
    <header data-page-header="true" className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Bot className="h-7 w-7 text-primary" /> Asistente empresarial</h1>
        <p className="mt-1 text-sm text-slate-600">Solo lectura: consulta tus operaciones sin modificar los datos de la empresa.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!snapshot} onClick={()=>setUsageOpen(true)}><BarChart3 className="mr-2 h-4 w-4"/>Mi consumo</Button>
        <Button variant="outline" disabled={busy||!snapshot} onClick={()=>setTelegramOpen(true)}><Send className="mr-2 h-4 w-4"/>Telegram</Button>
        <Button variant="outline" disabled={busy || !snapshot} onClick={() => setSettings(true)}><Settings2 className="mr-2 h-4 w-4" /> Configuración</Button>
      </div>
    </header>
    {connectionNotice&&<p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{connectionNotice}</p>}
    <div className="flex gap-2 lg:hidden">
      <Button variant={showNotes ? 'outline' : 'default'} onClick={() => setSearchParams({})}>Conversaciones</Button>
      <Button variant={showNotes ? 'default' : 'outline'} onClick={() => setSearchParams({ panel: 'notas' })}>Notas y recordatorios</Button>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p className="flex-1">{error}</p>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => {
        setError(''); void (async () => { try { await refresh(); if (selected) await loadMessages(selected) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo actualizar.') } })()
      }}>Actualizar</Button>
    </div>}
    {initialLoading ? <p role="status" className="p-8 text-center text-slate-500">Cargando tu asistente…</p> :
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label="Chat empresarial" className={`min-w-0 rounded-xl border bg-white shadow-sm ${showNotes ? 'hidden lg:block' : ''}`}>
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">Conversación
              <select value={selected} disabled={busy || loadingMessages} onChange={e => switchConversation(e.target.value)} className="mt-1 w-full rounded-md border p-2 text-sm text-slate-900">
                <option value="">Nueva conversación</option>
                {snapshot?.conversations.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <Button variant="outline" size="icon" disabled={busy || loadingMessages} aria-label="Nueva conversación" onClick={() => switchConversation('')}><Plus className="h-4 w-4" /></Button>
            {selected && <Button variant="ghost" size="icon" disabled={busy || loadingMessages} aria-label="Eliminar conversación" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" /></Button>}
          </div>
          {deleting && <div className="flex flex-wrap items-center gap-2 border-b bg-red-50 p-3 text-sm">
            <span>¿Eliminar esta conversación y sus mensajes?</span>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void removeConversation()}>Eliminar</Button>
            <Button size="sm" variant="outline" onClick={() => setDeleting(false)}>Cancelar</Button>
          </div>}
          <div className="grid gap-3 border-b bg-slate-50/70 p-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">Proveedor
              <select value={provider} disabled={busy} onChange={e => { setProvider(e.target.value as ChatProvider); setModelOwner(null); setModelError('') }} className="mt-1 w-full rounded-md border bg-white p-2 text-sm text-slate-900">
                {Object.entries(PROVIDER_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">Modelo
              <select value={modelOwner === provider ? model : ''} disabled={busy || !connected || modelOwner !== provider} onChange={e => setModel(e.target.value)} className="mt-1 w-full rounded-md border bg-white p-2 text-sm text-slate-900">
                <option value="">{connected ? 'Cargando modelos…' : 'Conecta una clave'}</option>
                {modelOwner === provider && models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </div>
          {modelError && <div role="alert" className="flex items-center gap-2 p-3 text-sm text-red-700">{modelError}
            <Button size="sm" variant="outline" onClick={() => setKeyRevision(value => value + 1)}>Reintentar</Button>
          </div>}
          <div className="h-[min(48vh,540px)] min-h-64 space-y-4 overflow-y-auto p-4" role="log" aria-label="Mensajes" aria-live="polite" aria-busy={busy}>
            {hasMore && <Button variant="outline" size="sm" disabled={busy || loadingMessages} onClick={() => void loadMessages(selected, true).catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar.'))}>Cargar mensajes anteriores</Button>}
            {!messages.length && <div className="mx-auto flex max-w-sm flex-col items-center py-8 text-center">
              <MessageSquare className="mb-4 h-9 w-9 text-primary/60" />
              <h2 className="font-semibold">Tus operaciones, en una conversación</h2>
              <p className="mt-2 text-sm text-slate-500">Pregunta por los pedidos de hoy, revisa pendientes o consulta tus notas.</p>
              {!connected && <Button variant="outline" className="mt-4" disabled={!snapshot} onClick={() => setSettings(true)}>Conectar mi IA</Button>}
            </div>}
            {messages.map(message => <article key={message.id} className={`max-w-[94%] rounded-xl p-3 sm:max-w-[85%] ${message.role === 'user' ? 'ml-auto bg-primary text-white' : 'border bg-slate-50 text-slate-900'}`}>
              <p className={`mb-1 text-xs ${message.role === 'user' ? 'text-white/75' : 'text-slate-500'}`}>{message.role === 'user' ? 'Tú' : message.model}</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
              {message.reports?.map(report=><ReportAttachment key={report.id} report={report}/>)}
              {message.status === 'failed' && <p className="mt-2 text-xs">No se completó esta consulta. Puedes volver a enviarla.</p>}
              {message.status === 'pending' && <p className="mt-2 text-xs">Consulta en curso. Actualiza el historial si no aparece la respuesta.</p>}
            </article>)}
            {busy && <p role="status" className="text-sm text-slate-500">Consultando…</p>}
            <div ref={bottom} />
          </div>
          <form className="space-y-2 border-t p-3" onSubmit={e => { e.preventDefault(); void send() }}>
            <label htmlFor="chat-message" className="sr-only">Tu consulta</label>
            <textarea id="chat-message" value={draft} onChange={e => setDraft(e.target.value)} maxLength={8000} rows={3}
              disabled={busy || !snapshot} placeholder="¿Cuántos pedidos están pendientes hoy?" className="w-full resize-y rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">El proveedor recibe el contexto reciente. El consumo usa tu cuenta.</p>
              <Button type="submit" disabled={busy || loadingMessages || !connected || !modelReady || !draft.trim() || !snapshot?.encryption_ready}><Send className="mr-2 h-4 w-4" /> Enviar</Button>
            </div>
          </form>
        </section>
        <aside className={`rounded-xl border bg-white p-4 shadow-sm ${showNotes ? '' : 'hidden lg:block'}`}>
          <ChatNotes notes={snapshot?.notes ?? []} onChanged={async () => { await refresh() }} />
        </aside>
      </div>}
    {settings && snapshot && <ChatSettings credentials={snapshot.credentials} encryptionReady={snapshot.encryption_ready} initialProvider={provider} onConnected={connectedKey} onDisconnected={disconnectedKey} onClose={() => setSettings(false)} />}
    {telegramOpen&&<TelegramSettings provider={provider} model={modelReady?model:''} conversationId={selected} onClose={()=>setTelegramOpen(false)} onChanged={async()=>{await refresh()}}/>}
    {usageOpen&&snapshot&&<ChatUsage conversations={snapshot.conversations} onClose={()=>setUsageOpen(false)}/>}
  </div>
}
