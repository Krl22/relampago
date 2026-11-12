import {z} from 'npm:zod@4.3.6';
import {ChatError,type ReportArgs} from './validation.ts';

export const REPORT_BUCKET='enterprise-chat-reports';
export const reportMime={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf'} as const;
export const reportDataSchema=z.object({dataset:z.enum(['orders','notes','activity']),
  rows:z.array(z.record(z.string(),z.union([z.string(),z.number(),z.null()]))).max(2000),source_ids:z.array(z.uuid()).max(2000),
  scope:z.object({role:z.enum(['admin','staff','courier','client']),company_id:z.uuid().nullable()}),
  generated_at:z.string(),from:z.string().nullable(),to:z.string().nullable(),status:z.string().nullable(),
  timezone:z.literal('America/Lima'),coverage:z.string(),total_service_amount:z.number()});
export type ReportData=z.infer<typeof reportDataSchema>;
export interface Column{key:string;label:string;width:number;type?:'date'|'datetime'|'money'|'integer'|'status'|'event'}
export const titles={orders:'Reporte de pedidos',notes:'Notas personales pendientes',activity:'Actividad registrada en pedidos'};
export const columns:Record<ReportArgs['dataset'],Column[]>={
  orders:[{key:'order_number',label:'Pedido',width:12,type:'integer'},{key:'scheduled_date',label:'Fecha programada',width:19,type:'date'},
    {key:'status',label:'Estado',width:18,type:'status'},{key:'destination_district',label:'Distrito',width:24},
    {key:'packages_count',label:'Bultos',width:10,type:'integer'},{key:'total_amount',label:'Importe servicio (S/)',width:22,type:'money'},
    {key:'amount_to_collect',label:'Por cobrar (S/)',width:20,type:'money'},{key:'amount_collected',label:'Cobrado (S/)',width:18,type:'money'}],
  notes:[{key:'created_at',label:'Creada (Lima)',width:22,type:'datetime'},{key:'body',label:'Nota',width:85},
    {key:'remind_at',label:'Recordatorio (Lima)',width:24,type:'datetime'}],
  activity:[{key:'created_at',label:'Fecha (Lima)',width:23,type:'datetime'},{key:'actor_name',label:'Usuario registrado',width:28},
    {key:'order_number',label:'Pedido',width:12,type:'integer'},{key:'event_type',label:'Acción',width:23,type:'event'},
    {key:'from_status',label:'Estado anterior',width:20,type:'status'},{key:'to_status',label:'Estado nuevo',width:20,type:'status'}],
};
const statuses:Record<string,string>={pending:'Registrado',picked_up:'Pendiente',in_transit:'En ruta',delivered:'Entregado',failed:'Rechazado',cancelled:'Anulado'};
const events:Record<string,string>={created:'Creación',status_change:'Cambio de estado',assigned:'Asignación'};
export const limaDate=(value:string)=>new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
export function displayCell(value:string|number|null|undefined,column:Column):string{
  if(value==null)return '—';
  if(column.type==='datetime')return limaDate(String(value));
  if(column.type==='date')return String(value).split('-').reverse().join('/');
  if(column.type==='money')return new Intl.NumberFormat('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
  if(column.type==='status')return statuses[String(value)]??String(value);
  if(column.type==='event')return events[String(value)]??String(value);
  return String(value);
}
export const period=(data:ReportData)=>`${data.from??'Inicio del historial'} al ${data.to??'Último registro'} · Hora de Lima`;
export function checkReportSize(data:ReportData,format:ReportArgs['format']){
  if(data.rows.length>(format==='xlsx'?2000:500))throw new ChatError(422,'El reporte supera el límite de este formato. Reduce el intervalo o pide Excel (hasta 2.000 filas).');
  if(JSON.stringify(data.rows).length>250000)throw new ChatError(422,'El reporte contiene demasiado texto. Reduce los filtros para obtener un archivo completo.');
}
