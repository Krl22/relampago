import { useState } from 'react'
import { Bell, Check, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { chatRequest, notesChanged } from '../../lib/enterpriseChat'
import type { ChatNote } from '../../lib/enterpriseChat'

export function ChatNotes({ notes, onChanged }: { notes: ChatNote[]; onChanged: () => Promise<void> }) {
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action(); await onChanged(); notesChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la nota.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4" aria-label="Notas y recordatorios">
    <div>
      <h2 className="flex items-center gap-2 font-semibold"><Bell className="h-4 w-4" /> Notas y recordatorios</h2>
      <p className="mt-1 text-xs text-slate-500">Privados para tu cuenta. Los avisos aparecen al abrir la web y se actualizan cada minuto.</p>
    </div>
    <form className="space-y-3" onSubmit={e => {
      e.preventDefault()
      void mutate(async () => {
        await chatRequest({ action: 'save_note', body, remind_at: due ? new Date(due).toISOString() : null })
        setBody(''); setDue('')
      })
    }}>
      <label className="block text-sm">Nota
        <textarea value={body} onChange={e => setBody(e.target.value)} required maxLength={4000} rows={3}
          disabled={busy} className="mt-1 w-full resize-y rounded-md border p-2" placeholder="Algo importante para recordar…" />
      </label>
      <label className="block text-sm">Recordar el (opcional)
        <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} disabled={busy}
          className="mt-1 w-full rounded-md border p-2" />
      </label>
      <p className="text-xs text-slate-500">Hora de tu dispositivo: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Vincula Telegram y activa sus avisos para recibirlos con la web cerrada.</p>
      <Button type="submit" size="sm" disabled={busy || !body.trim()}>Guardar nota</Button>
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!notes.length && <p className="text-sm text-slate-500">No tienes notas pendientes.</p>}
    {notes.length >= 100 && <p className="text-xs text-amber-800">Se muestran las primeras 100 notas pendientes.</p>}
    <ul className="space-y-2">
      {notes.map(note => <li key={note.id} className={`rounded-lg border p-3 ${note.remind_at && Date.parse(note.remind_at) <= Date.now() ? 'border-amber-300 bg-amber-50' : 'bg-slate-50'}`}>
        <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>
        {note.remind_at && <p className="mt-2 text-xs text-slate-600">{new Date(note.remind_at).toLocaleString('es')}</p>}
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void mutate(() => chatRequest({ action: 'complete_note', note_id: note.id }))}>
            <Check className="mr-1 h-4 w-4" /> Completar
          </Button>
          <Button size="icon" variant="ghost" disabled={busy} aria-label="Eliminar nota" onClick={() => void mutate(() => chatRequest({ action: 'delete_note', note_id: note.id }))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </li>)}
    </ul>
  </section>
}
