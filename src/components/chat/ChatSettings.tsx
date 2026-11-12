import { useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { chatRequest, PROVIDER_NAMES } from '../../lib/enterpriseChat'
import type { ChatCredential, ChatModel, ChatProvider } from '../../lib/enterpriseChat'

export function ChatSettings({ credentials, encryptionReady, initialProvider, onConnected, onDisconnected, onClose }: {
  credentials: ChatCredential[]; encryptionReady: boolean; initialProvider: ChatProvider
  onConnected: (provider: ChatProvider, models: ChatModel[]) => void
  onDisconnected: (provider: ChatProvider) => void; onClose: () => void
}) {
  const [provider, setProvider] = useState<ChatProvider>(initialProvider)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const connected = credentials.some(c => c.provider === provider)

  async function save() {
    setBusy(true); setError(''); setNotice('')
    const submitted = key
    setKey('')
    try {
      const data = await chatRequest<{ models: ChatModel[] }>({ action: 'save_key', provider, key: submitted })
      // Use the verified catalog returned by this request, without a second load or page refresh.
      onConnected(provider, data.models)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo conectar la clave.') }
    finally { setBusy(false) }
  }
  async function disconnect() {
    setBusy(true); setError(''); setNotice(''); setKey('')
    try {
      await chatRequest({ action: 'delete_key', provider })
      onDisconnected(provider); setNotice('Clave eliminada. El historial se conserva.')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo desconectar.') }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Conectar tu IA</DialogTitle>
        <DialogDescription>Cada usuario usa sus propias claves. El consumo se cobra en su cuenta del proveedor.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save() }}>
        <label className="block text-sm font-medium">Proveedor
          <select className="mt-1 w-full rounded-md border p-2" value={provider} disabled={busy}
            onChange={e => { setProvider(e.target.value as ChatProvider); setKey(''); setError(''); setNotice('') }}>
            {Object.entries(PROVIDER_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <p className="text-sm">Estado: <strong>{connected ? 'Conectado' : 'Sin clave'}</strong></p>
        <label className="block text-sm font-medium">{connected ? 'Reemplazar API key' : 'Tu API key'}
          <input type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={key}
            minLength={10} maxLength={4096} required disabled={busy || !encryptionReady}
            onChange={e => setKey(e.target.value)} className="mt-1 w-full rounded-md border p-2" placeholder="Pega la clave del proveedor" />
        </label>
        <p className="flex gap-2 text-xs text-slate-600"><ShieldCheck className="h-4 w-4 shrink-0" />
          La clave se guarda cifrada en el servidor y no se vuelve a mostrar. Al consultar, el proveedor elegido recibe tu contexto reciente y los datos que solicites.</p>
        {!encryptionReady && <p role="alert" className="text-sm text-amber-800">Falta configurar el cifrado en el servidor.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !key.trim() || !encryptionReady}>{busy ? 'Procesando…' : 'Verificar y guardar'}</Button>
          {connected && <Button type="button" variant="outline" disabled={busy} onClick={() => void disconnect()}>Eliminar clave</Button>}
        </div>
      </form>
      <p className="text-xs text-slate-500">Disponibles: OpenAI, Claude, DeepSeek y OpenRouter. OpenRouter muestra modelos compatibles con las herramientas del asistente.</p>
    </DialogContent>
  </Dialog>
}
