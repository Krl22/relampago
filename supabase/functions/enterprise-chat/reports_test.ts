import assert from 'node:assert/strict';
import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {PDFDocument} from 'npm:pdf-lib@1.17.1';
import ExcelJS from 'npm:exceljs@4.4.0';
import JSZip from 'npm:jszip@3.10.1';
import {renderReport} from './report-render.ts';
import {createReport,downloadReport} from './reports.ts';
import {reportArgs} from './validation.ts';
import type {ReportData} from './report-model.ts';
import {dispatchTelegramDeliveries} from './telegram-worker.ts';
import {encryptKey} from './crypto.ts';

const user='10000000-0000-4000-8000-000000000001',conversation='20000000-0000-4000-8000-000000000001',request='30000000-0000-4000-8000-000000000001';
export function fixtureReport(count=80):ReportData{
  const ids=Array.from({length:count},(_,i)=>`40000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  return {dataset:'orders',rows:ids.map((id,i)=>({id,order_number:i+1,scheduled_date:'2026-11-04',status:'pending',
    destination_district:i===0?'=1+1':`Distrito ${i+1} · José Núñez`,packages_count:2,total_amount:10.5,amount_to_collect:20,amount_collected:0})),
    source_ids:ids,scope:{role:'client',company_id:conversation},generated_at:'2026-11-04T12:00:00Z',from:'2026-11-04',to:'2026-11-04',status:null,
    timezone:'America/Lima',coverage:'Pedidos permitidos por fecha programada. Importe del servicio no equivale a dinero cobrado.',total_service_amount:count*10.5};
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

Deno.test('Real report renderers: full Excel rows, literal cells, Word tables, multipage Unicode PDF and explicit size limits',async()=>{
  const data=fixtureReport(80);
  const xlsx=await renderReport(data,'xlsx');
  const book=new ExcelJS.Workbook();await book.xlsx.load(new Uint8Array(xlsx).buffer);
  const sheet=book.getWorksheet('Reporte')!;
  assert.equal(sheet.getCell('A7').value,1);assert.equal(sheet.getCell('A86').value,80);
  assert.equal(sheet.getCell('D7').value,'=1+1');assert.equal(sheet.getCell('D7').type,ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('F3').result,840);
  const docx=await renderReport(data,'docx');
  const zip=await JSZip.loadAsync(docx);const xml=await zip.file('word/document.xml')!.async('string');
  assert.ok(xml.includes('José Núñez'));assert.ok(xml.includes('Distrito 80'));
  assert.equal((xml.match(/<w:tr[ >]/g)??[]).length,81);
  const pdf=await renderReport(data,'pdf');const parsed=await PDFDocument.load(pdf);
  assert.ok(parsed.getPageCount()>1);
  for(const [format,count] of [['pdf',501],['docx',501],['xlsx',2001]] as const)
    await assert.rejects(()=>renderReport(fixtureReport(count),format),/límite/);
  assert.equal(reportArgs.safeParse({dataset:'orders',format:'xlsx',from:null,to:null,status:null,actor_id:null}).success,false);
  assert.equal(reportArgs.safeParse({dataset:'orders',format:'xlsx',from:'2026-11-04',to:'2026-11-04',status:null,actor_id:null,sql:'SELECT 1'}).success,false);
});

Deno.test('Artifact pipeline: reads the complete snapshot, privately uploads once, deduplicates and authorizes each short-lived download',async()=>{
  const original=globalThis.fetch;let record:Record<string,unknown>|null=null;let uploaded=0,snapshotReads=0;let authorized=true;
  const admin=createClient('http://localhost:54321','test-service',{auth:{persistSession:false}});
  globalThis.fetch=(async(input,init)=>{
    const req=input instanceof Request?input:new Request(input,init);const url=new URL(req.url);
    assert.equal(url.hostname,'localhost');
    if(url.pathname==='/rest/v1/chat_reports'){
      if(req.method==='HEAD')return new Response(null,{headers:{'Content-Range':'*/0'}});
      if(req.method==='POST'){record=await req.json();return json(null,201)}
      if(req.method==='PATCH'){
        record={...record,...await req.json(),created_at:'2026-11-04T12:00:00Z',expires_at:'2099-11-04T12:00:00Z'};return json(record);
      }
      return json(record);
    }
    if(url.pathname==='/rest/v1/chat_requests')return json({id:request});
    if(url.pathname.endsWith('/rpc/chat_report_data')){snapshotReads++;return json(fixtureReport(80))}
    if(url.pathname.startsWith('/storage/v1/object/enterprise-chat-reports/')){
      uploaded++;assert.equal(req.headers.get('Content-Type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      assert.ok((await req.arrayBuffer()).byteLength>1000);return json({Key:'fixture-file'});
    }
    if(url.pathname.endsWith('/rpc/chat_authorize_report'))return json(authorized?{id:record!.id,storage_path:record!.storage_path,
      filename:record!.filename,format:'xlsx',byte_size:record!.byte_size,row_count:80}:null);
    if(url.pathname.startsWith('/storage/v1/object/sign/')){
      assert.equal((await req.json()).expiresIn,60);return json({signedURL:'/object/sign/enterprise-chat-reports/fixture.xlsx?token=test-only'});
    }
    throw new Error('Unexpected report fixture request');
  }) as typeof fetch;
  try{
    const args={dataset:'orders',format:'xlsx',from:'2026-11-04',to:'2026-11-04',status:null,actor_id:null};
    const context={admin,reader:admin,userId:user,conversationId:conversation,requestId:request,telegram:false};
    const result=await createReport(context,args);assert.equal(result.report.row_count,80);
    assert.equal('storage_path' in result.report,false);assert.equal('url' in result.report,false);
    await createReport(context,args);assert.equal(uploaded,1);assert.equal(snapshotReads,1);
    const download=await downloadReport(admin,admin,user,result.report.id);assert.ok(download.url.includes('/object/sign/'));
    authorized=false;await assert.rejects(()=>downloadReport(admin,admin,user,result.report.id),/permisos/);
  }finally{globalThis.fetch=original;}
});

Deno.test('Telegram documents use multipart uploads, a rechecked owner and downloadable content instead of a public link',async()=>{
  const original=globalThis.fetch;const master=btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));
  const token='123456789:'+'fixture_not_a_real_token_'.repeat(2);const encrypted=await encryptKey(token,user,'telegram',master);
  let claimed=false,sent=false;
  globalThis.fetch=(async(input,init)=>{
    const req=input instanceof Request?input:new Request(input,init);const url=new URL(req.url);
    if(url.hostname==='api.telegram.org'){
      assert.ok(url.pathname.endsWith('/sendDocument'));const form=await req.formData();
      assert.equal(form.get('chat_id'),'111');assert.equal(form.get('protect_content'),'false');
      assert.equal((form.get('document') as File).name,'reporte.pdf');sent=true;return json({ok:true,result:{message_id:1}});
    }
    assert.equal(url.hostname,'localhost');
    if(url.pathname.endsWith('chat_telegram_claim_delivery')){if(claimed)return json([]);claimed=true;return json([
      {id:request,user_id:user,bot_id:123456789,telegram_id:111,kind:'document',report_id:conversation,body:'reporte.pdf',attempts:1}]);}
    if(url.pathname.endsWith('chat_telegram_accounts'))return req.method==='GET'?json({bot_id:123456789,telegram_id:111,blocked:false,encrypted_token:encrypted}):json(null);
    if(url.pathname.includes('/auth/v1/admin/users/'))return json({user:{id:user,is_anonymous:false,app_metadata:{}}});
    if(url.pathname.endsWith('profiles'))return json({id:user,role:'admin',company_id:null});
    if(url.pathname.endsWith('chat_authorize_report')){assert.equal((await req.json()).p_viewer_id,user);return json({id:conversation,storage_path:user+'/report.pdf',filename:'reporte.pdf',format:'pdf',byte_size:10,row_count:80});}
    if(url.pathname.startsWith('/storage/v1/object/enterprise-chat-reports/'))return new Response(new Blob(['%PDF-fixture'],{type:'application/pdf'}));
    if(url.pathname.endsWith('chat_telegram_deliveries')){assert.equal((await req.json()).status,'sent');return json(null);}
    throw new Error('Unexpected document fixture request');
  }) as typeof fetch;
  try{await dispatchTelegramDeliveries(createClient('http://localhost:54321','fixture',{auth:{persistSession:false}}),master,2);assert.equal(sent,true);}
  finally{globalThis.fetch=original;}
});
