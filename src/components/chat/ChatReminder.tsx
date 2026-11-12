import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useAuth } from '../AuthProvider'
import { chatRequest } from '../../lib/enterpriseChat'

export function ChatReminder() {
  const { user, profile } = useAuth()
  // Bind the result to the session owner to prevent a flash of another user's reminder count.
  const [result, setResult] = useState<{ userId: string; count: number } | null>(null)
  useEffect(() => {
    if (!user || profile?.role !== 'admin') return
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const data = await chatRequest<{ count: number }>({ action: 'due_notes' })
        if (active) setResult({ userId: user.id, count: data.count })
      } catch { /* A deployment without the optional chat backend keeps the main app usable. */ }
      finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60000)
    window.addEventListener('relampago:chat-notes-changed', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false; window.clearInterval(timer)
      window.removeEventListener('relampago:chat-notes-changed', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [user, profile])
  if (!user || profile?.role !== 'admin' || result?.userId !== user.id || result.count < 1) return null
  return <Link to="/asistente?panel=notas" role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 print:hidden">
    <Bell className="h-4 w-4 shrink-0" /> Tienes {result.count} {result.count === 1 ? 'recordatorio pendiente' : 'recordatorios pendientes'}.
    <span className="ml-auto underline">Ver</span>
  </Link>
}
