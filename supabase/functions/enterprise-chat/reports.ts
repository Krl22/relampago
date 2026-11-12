import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.95.3';
import {z} from 'npm:zod@4.3.6';
import {ChatError,reportArgs} from './validation.ts';
import {REPORT_BUCKET,reportDataSchema,reportMime,titles} from './report-model.ts';
import {sha256} from './telegram-api.ts';

export interface ReportContext{admin:SupabaseClient;reader:SupabaseClient;userId:string;conversationId:string;requestId:string;telegram:boolean}
export const reportMetadataColumns='id,request_id,dataset,format,filename,row_count,byte_size,created_at,expires_at';
const metadataSchema=z.object({id:z.uuid(),request_id:z.uuid().nullable(),dataset:z.enum(['orders','notes','activity']),
  format:z.enum(['xlsx','docx','pdf']),filename:z.string(),row_count:z.number(),byte_size:z.number(),created_at:z.string(),expires_at:z.string()});
export type ReportMetadata=z.infer<typeof metadataSchema>;

export async function createReport(context:ReportContext,raw:unknown){
  const args=reportArgs.parse(raw);const {admin,reader,userId,requestId,conversationId}=context;
  const fingerprint=await sha256(JSON.stringify(args));
  const {data:existing,error:existingError}=await admin.from('chat_reports').select(`${reportMetadataColumns},status`)
    .eq('user_id',userId).eq('request_id',requestId).eq('fingerprint',fingerprint).maybeSingle();
  if(existingError)throw new ChatError(500,'No se pudo consultar el estado del archivo.');
  if(existing){
    if(existing.status==='ready')return reportResult(metadataSchema.parse(existing));
    throw new ChatError(409,'Este archivo ya se está procesando o no se pudo completar. Solicítalo de nuevo si es necesario.');
  }
  const {data:turn,error:turnError}=await admin.from('chat_requests').select('id').eq('id',requestId).eq('user_id',userId)
    .eq('conversation_id',conversationId).eq('status','running').gt('expires_at',new Date().toISOString()).maybeSingle();
  if(turnError||!turn)throw new ChatError(409,'La consulta ya no está activa. Envía de nuevo la solicitud del reporte.');
  const {count,error:countError}=await admin.from('chat_reports').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('request_id',requestId);
  if(countError)throw new ChatError(500,'No se pudo comprobar el límite de archivos.');
  if((count??0)>=3)throw new ChatError(422,'Puedes generar hasta tres archivos por consulta.');
  const id=crypto.randomUUID();const filename=`relampago_${args.dataset==='orders'?'pedidos':args.dataset==='notes'?'notas':'actividad'}_${args.from??'historial'}_${args.to??'actual'}.${args.format}`;
  const path=`${userId}/${id}.${args.format}`;
  const {error:reserveError}=await admin.from('chat_reports').insert({id,user_id:userId,request_id:requestId,conversation_id:conversationId,
    dataset:args.dataset,format:args.format,fingerprint,filename,storage_path:path});
  if(reserveError)throw new ChatError(500,'No se pudo preparar el archivo.');
  let uploaded=false;
  try{
    const {data:rawData,error}=await reader.rpc('chat_report_data',{p_dataset:args.dataset,p_from:args.from,p_to:args.to,p_status:args.status,p_actor_id:args.actor_id,
      ...(context.telegram?{p_viewer_id:userId}:{})});
    if(error){
      if(error.code==='42501')throw new ChatError(403,'No tienes permiso para exportar estos datos.');
      if(error.message.includes('report_row_limit'))throw new ChatError(422,'Hay más de 2.000 registros. Reduce los filtros; no se generará un archivo incompleto.');
      throw new ChatError(500,'No se pudieron consultar los datos completos del reporte.');
    }
    const data=reportDataSchema.parse(rawData);
    const {renderReport}=await import('./report-render.ts');
    const bytes=await renderReport(data,args.format);
    if(bytes.byteLength>10*1024*1024)throw new ChatError(422,'El archivo es demasiado grande. Reduce los filtros.');
    const {error:uploadError}=await admin.storage.from(REPORT_BUCKET).upload(path,bytes,{contentType:reportMime[args.format],upsert:false,cacheControl:'0'});
    if(uploadError)throw new ChatError(500,'No se pudo guardar el archivo privado.');
    uploaded=true;
    const {data:record,error:saveError}=await admin.from('chat_reports').update({status:'ready',row_count:data.rows.length,byte_size:bytes.byteLength,
      source_ids:data.source_ids,access_scope:data.scope}).eq('id',id).eq('user_id',userId).select(reportMetadataColumns).single();
    if(saveError||!record)throw new ChatError(500,'No se pudo finalizar el archivo.');
    return reportResult(metadataSchema.parse(record));
  }catch(error){
    if(uploaded)await admin.storage.from(REPORT_BUCKET).remove([path]);
    await admin.from('chat_reports').update({status:'failed'}).eq('id',id).eq('user_id',userId);
    throw error;
  }
}
function reportResult(report:ReportMetadata){
  return {report:{id:report.id,filename:report.filename,format:report.format,row_count:report.row_count,expires_at:report.expires_at},
    delivery:'Archivo creado. En la web aparece un botón de descarga y en Telegram se envía como adjunto. No inventes enlaces ni rutas.',
    title:titles[report.dataset]};
}

const authorizationSchema=z.object({id:z.uuid(),storage_path:z.string(),filename:z.string(),format:z.enum(['xlsx','docx','pdf']),byte_size:z.number(),row_count:z.number()});
export async function authorizeReport(reader:SupabaseClient,userId:string,reportId:string,telegram=false){
  const {data,error}=await reader.rpc('chat_authorize_report',{p_report_id:reportId,...(telegram?{p_viewer_id:userId}:{})});
  if(error||!data)throw new ChatError(403,'El archivo venció o ya no está disponible con tus permisos actuales. Solicita otro reporte.');
  return authorizationSchema.parse(data);
}
export async function downloadReport(admin:SupabaseClient,reader:SupabaseClient,userId:string,reportId:string){
  const report=await authorizeReport(reader,userId,reportId);
  const {data,error}=await admin.storage.from(REPORT_BUCKET).createSignedUrl(report.storage_path,60,{download:report.filename});
  if(error||!data)throw new ChatError(500,'No se pudo preparar la descarga.');
  return {url:data.signedUrl,filename:report.filename,expires_in:60};
}
export async function cleanupReports(admin:SupabaseClient){
  const orphans=await admin.rpc('chat_report_orphans');
  if(!orphans.error&&orphans.data?.length)await admin.storage.from(REPORT_BUCKET).remove(orphans.data);
  const {data,error}=await admin.from('chat_reports').select('id,storage_path')
    .or(`expires_at.lt.${new Date().toISOString()},conversation_id.is.null,request_id.is.null`).limit(20);
  if(error||!data?.length)return;
  const {error:removeError}=await admin.storage.from(REPORT_BUCKET).remove(data.map(r=>r.storage_path));
  if(!removeError)await admin.from('chat_reports').delete().in('id',data.map(r=>r.id));
}

export const reportTool={name:'create_report',description:'Genera un archivo real Excel (xlsx), Word (docx) o PDF con datos autorizados completos, sin usar la muestra del chat. No modifica datos empresariales. Pedidos: requiere from/to por fecha programada; hasta 366 fechas. Notas: personales pendientes por fecha de creación. Actividad: solo admin/staff, cobertura parcial de eventos. Máximo 2.000 filas en Excel, 500 en Word/PDF y tres archivos por consulta. Si supera el límite, pide filtros más precisos. Devuelve metadatos, no URL; el sistema adjunta el archivo.',
  parameters:{type:'object',additionalProperties:false,properties:{dataset:{type:'string',enum:['orders','notes','activity']},format:{type:'string',enum:['xlsx','docx','pdf']},
    from:{type:['string','null'],description:'Fecha inicial YYYY-MM-DD o null; obligatoria para pedidos.'},to:{type:['string','null'],description:'Fecha final YYYY-MM-DD o null; obligatoria para pedidos.'},
    status:{type:['string','null'],enum:['pending','picked_up','in_transit','delivered','failed','cancelled',null],description:'Solo para pedidos; null sin filtro.'},
    actor_id:{type:['string','null'],description:'UUID del actor solo para actividad; null en otros reportes.'}},required:['dataset','format','from','to','status','actor_id']}};
