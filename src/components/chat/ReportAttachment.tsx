import {useState} from 'react'
import {Download,FileText} from 'lucide-react'
import {Button} from '../ui/button'
import {chatRequest,type ChatReport} from '../../lib/enterpriseChat'

export function ReportAttachment({report}:{report:ChatReport}){
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const expired=Date.parse(report.expires_at)<=Date.now()
  async function download(){
    setBusy(true);setError('')
    try{
      const data=await chatRequest<{url:string;filename:string}>({action:'download_report',report_id:report.id})
      const response=await fetch(data.url,{cache:'no-store'})
      if(!response.ok)throw new Error('El archivo ya no está disponible. Solicita otro reporte.')
      const url=URL.createObjectURL(await response.blob())
      const anchor=document.createElement('a');anchor.href=url;anchor.download=data.filename;document.body.append(anchor);anchor.click();anchor.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),60000)
    }catch(e){setError(e instanceof Error?e.message:'No se pudo descargar el archivo.')}
    finally{setBusy(false)}
  }
  return <div className="mt-3 rounded-lg border border-blue-200 bg-white p-3 text-slate-900">
    <div className="flex min-w-0 items-start gap-2"><FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary"/>
      <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{report.filename}</p>
        <p className="mt-1 text-xs text-slate-500">{report.row_count} registros · {report.format.toUpperCase()} · {Math.max(1,Math.ceil(report.byte_size/1024))} KB</p>
        <p className="mt-1 text-xs text-slate-500">{expired?'Archivo vencido. Solicita otro reporte.':'Descarga privada disponible durante 24 horas.'}</p>
      </div>
    </div>
    <Button size="sm" variant="outline" className="mt-2" disabled={busy||expired} onClick={()=>void download()}>
      <Download className="mr-2 h-4 w-4"/>{busy?'Preparando descarga…':`Descargar ${report.format.toUpperCase()}`}
    </Button>
    {error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </div>
}
