import {useEffect,useState} from 'react'
import {BarChart3,RefreshCw} from 'lucide-react'
import {Button} from '../ui/button'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '../ui/dialog'
import {chatRequest,PROVIDER_NAMES,type ChatProvider,type ChatConversation,type ChatUsage as Usage,type UsageGroup} from '../../lib/enterpriseChat'

const day=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
const number=(value:number)=>new Intl.NumberFormat('es-PE').format(value)
const usd=(value:number)=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6}).format(value)
function Cost({item}:{item:UsageGroup}){
 return <div className="space-y-1 text-xs"><p>{usd(item.reported_usd)} reportado</p><p>{usd(item.estimated_usd)} estimado</p>
  {item.unpriced_calls>0&&<p className="text-amber-800">{item.unpriced_calls} llamadas sin costo disponible</p>}</div>
}
export function ChatUsage({conversations,onClose}:{conversations:ChatConversation[];onClose:()=>void}){
 const [filters,setFilters]=useState(()=>({from:day(new Date(Date.now()-29*86400000)),to:day(new Date()),provider:'' as ChatProvider|'',conversation:''}))
 const [query,setQuery]=useState(filters)
 const [data,setData]=useState<Usage|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{
  let active=true
  chatRequest<Usage>({action:'usage_summary',from:query.from,to:query.to,provider:query.provider||null,conversation_id:query.conversation||null})
   .then(result=>{if(active)setData(result)})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudo cargar el consumo.')})
   .finally(()=>{if(active)setBusy(false)})
  return()=>{active=false}
 },[query,revision])
 const apply=()=>{setBusy(true);setError('');setData(null);setQuery({...filters});setRevision(value=>value+1)}
 const totals=data?.totals
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[90dvh] w-[calc(100%-1rem)] max-w-5xl overflow-y-auto">
  <DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5"/>Mi consumo</DialogTitle>
   <DialogDescription>Tu consumo del asistente en la web y Telegram, con fechas de Lima. Incluye las llamadas intermedias para consultar datos y generar archivos.</DialogDescription></DialogHeader>
  <form className="grid grid-cols-1 gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={e=>{e.preventDefault();apply()}}>
   <label className="text-xs font-medium">Desde<input type="date" required value={filters.from} max={filters.to} onChange={e=>setFilters({...filters,from:e.target.value})} className="mt-1 block w-full rounded-md border bg-white p-2"/></label>
   <label className="text-xs font-medium">Hasta<input type="date" required value={filters.to} min={filters.from} onChange={e=>setFilters({...filters,to:e.target.value})} className="mt-1 block w-full rounded-md border bg-white p-2"/></label>
   <label className="text-xs font-medium">Proveedor del consumo<select aria-label="Proveedor del consumo" value={filters.provider} onChange={e=>setFilters({...filters,provider:e.target.value as ChatProvider|''})} className="mt-1 block w-full rounded-md border bg-white p-2"><option value="">Todos</option>{Object.entries(PROVIDER_NAMES).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <label className="min-w-0 text-xs font-medium">Conversación del consumo<select aria-label="Conversación del consumo" value={filters.conversation} onChange={e=>setFilters({...filters,conversation:e.target.value})} className="mt-1 block w-full rounded-md border bg-white p-2"><option value="">Todas</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
   <Button type="submit" className="self-end" disabled={busy}><RefreshCw className="mr-2 h-4 w-4"/>Actualizar consumo</Button>
  </form>
  {busy&&<p role="status" className="p-6 text-center text-sm text-slate-500">Cargando consumo…</p>}
  {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {totals&&<>
   <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {[['Costo reportado',usd(totals.reported_usd),'Informado por OpenRouter'],['Costo estimado',usd(totals.estimated_usd),'Proveedores directos con tarifa verificada'],['Tokens registrados',number(totals.input_tokens+totals.output_tokens),`${number(totals.input_tokens)} entrada · ${number(totals.output_tokens)} salida`],['Consultas y llamadas',number(totals.queries),`${number(totals.calls)} llamadas al modelo`]].map(([title,value,detail])=><div key={title} className="rounded-lg border p-4"><p className="text-xs text-slate-500">{title}</p><p className="mt-2 break-all text-xl font-semibold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>)}
   </div>
   {totals.calls===0&&<p className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">No hay consumo registrado en este intervalo. Los mensajes anteriores a esta actualización no tienen mediciones retroactivas.</p>}
   {(totals.unpriced_calls>0||totals.unmetered_calls>0)&&<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Totales parciales: {number(totals.unpriced_calls)} llamadas sin costo disponible y {number(totals.unmetered_calls)} sin conteo de tokens confirmado. Estos consumos no se consideran gratuitos. Una interrupción puede haber generado un cargo; comprueba el panel del proveedor.</p>}
   <p className="text-xs text-slate-500">{number(totals.cached_tokens)} tokens de caché y {number(totals.reasoning_tokens)} de razonamiento, incluidos en los totales. {number(totals.unconfirmed_calls)} llamadas sin respuesta confirmada.</p>
   {data!.models.length>0&&<section aria-label="Consumo por modelo"><h3 className="mb-2 font-semibold">Por proveedor y modelo</h3><div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">Modelo</th><th className="p-3">Llamadas</th><th className="p-3">Tokens</th><th className="p-3">Costo USD</th></tr></thead><tbody>{data!.models.map(item=><tr key={`${item.provider}:${item.model}`} className="border-t align-top"><td className="max-w-56 break-words p-3">{PROVIDER_NAMES[item.provider]}<span className="mt-1 block text-xs text-slate-500">{item.model}</span></td><td className="p-3">{number(item.calls)}</td><td className="p-3">{number(item.tokens)}</td><td className="p-3"><Cost item={item}/></td></tr>)}</tbody></table></div><p className="mt-1 text-xs text-slate-500">Hasta 100 modelos. Los totales incluyen todos los registros del intervalo.</p></section>}
   {data!.conversations.length>0&&<section aria-label="Consumo por conversación"><h3 className="mb-2 font-semibold">Por conversación</h3><div className="space-y-2">{data!.conversations.map(item=><div key={item.conversation_id??'deleted'} className="flex flex-wrap justify-between gap-3 rounded-lg border p-3"><div><p className="break-words text-sm font-medium">{item.title}</p><p className="text-xs text-slate-500">{number(item.calls)} llamadas · {number(item.tokens)} tokens</p></div><Cost item={item}/></div>)}</div><p className="mt-1 text-xs text-slate-500">Hasta 50 conversaciones recientes. Borrar una conversación conserva su consumo registrado.</p></section>}
   {data!.recent.length>0&&<section aria-label="Llamadas recientes"><h3 className="mb-2 font-semibold">Últimas 30 llamadas</h3><div className="space-y-2">{data!.recent.map(item=><div key={item.id} className="rounded-lg border p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><p>{new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'short'}).format(new Date(item.created_at))} · {item.channel==='telegram'?'Telegram':'Web'} · Paso {item.step+1}</p><p>{item.cost_usd===null?'Costo no disponible':`${usd(item.cost_usd)} ${item.cost_kind==='reported'?'reportado':'estimado'}`}</p></div><p className="mt-1 break-all text-slate-500">{item.model} · {item.input_tokens===null||item.output_tokens===null?'Tokens sin confirmar':`${number(item.input_tokens)} entrada / ${number(item.output_tokens)} salida`}</p>{item.price_note&&<p className="mt-1 text-slate-500">{item.price_note}{item.price_verified_at?` Verificada: ${day(new Date(item.price_verified_at))}.`:''}</p>}</div>)}</div></section>}
   <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">{data!.tracking_since?`Primer registro: ${day(new Date(data!.tracking_since))}. `:''}Solo incluye el uso de este chatbot. El saldo global, otras aplicaciones, recargas, impuestos y condiciones particulares de facturación pueden diferir. Si configuraste claves de otros proveedores dentro de OpenRouter, pueden existir cargos adicionales de esos proveedores. Los costos estimados usan tarifas fechadas; si falta una tarifa vigente, se muestra como no disponible. Las consultas rechazadas o interrumpidas pueden quedar sin medición confirmada.</p>
  </>}
 </DialogContent></Dialog>
}
