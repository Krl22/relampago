import type {ReportArgs} from './validation.ts';
import {checkReportSize,columns,displayCell,limaDate,period,titles,type ReportData} from './report-model.ts';

export async function renderReport(data:ReportData,format:ReportArgs['format']):Promise<Uint8Array>{
  checkReportSize(data,format);
  if(format==='xlsx')return renderExcel(data);
  if(format==='docx')return renderWord(data);
  return renderPdf(data);
}

async function renderExcel(data:ReportData){
  const {default:ExcelJS}=await import('npm:exceljs@4.4.0');
  const workbook=new ExcelJS.Workbook();workbook.creator='Relámpago Courier';workbook.created=new Date(data.generated_at);
  const sheet=workbook.addWorksheet('Reporte',{views:[{state:'frozen',ySplit:6}]});
  const cols=columns[data.dataset];sheet.columns=cols.map(col=>({key:col.key,width:col.width}));
  const last=cols.length;
  for(const row of [1,2,4])sheet.mergeCells(row,1,row,last);
  sheet.getCell(1,1).value=`RELÁMPAGO · ${titles[data.dataset]}`;sheet.getRow(1).height=32;
  sheet.getCell(1,1).font={name:'Calibri',size:18,bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getCell(1,1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1248C4'}};
  sheet.getCell(2,1).value=period(data);sheet.getRow(2).height=24;
  sheet.getCell(3,1).value='Registros';sheet.getCell(3,2).value=data.rows.length;
  if(data.dataset==='orders'){
    sheet.getCell(3,4).value='Total servicio (S/)';
    sheet.getCell(3,6).value=data.rows.length?{formula:`SUM(F7:F${6+data.rows.length})`,result:data.total_service_amount}:0;
    sheet.getCell(3,6).numFmt='"S/ "#,##0.00';
  }
  sheet.getCell(4,1).value=data.coverage;sheet.getCell(4,1).alignment={wrapText:true,vertical:'middle'};sheet.getRow(4).height=34;
  sheet.addTable({name:'Reporte',ref:'A6',headerRow:true,style:{theme:'TableStyleMedium2',showRowStripes:true},
    columns:cols.map(col=>({name:col.label,filterButton:true})),rows:data.rows.map(row=>cols.map(col=>{
      const value=row[col.key];
      if(value==null)return '';
      if(col.type==='money'||col.type==='integer')return Number(value);
      // All user-controlled values stay literal strings, never formula/hyperlink objects.
      return displayCell(value,col);
    }))});
  sheet.eachRow((row,index)=>{
    if(index>=6){row.font={name:'Calibri',size:11};row.alignment={vertical:'top',wrapText:true};}
    if(index>6&&index<=6+data.rows.length){
      cols.forEach((col,j)=>{if(col.type==='money')row.getCell(j+1).numFmt='#,##0.00';});
      row.height=data.dataset==='notes'?Math.min(180,Math.max(32,Math.ceil(String(data.rows[index-7].body??'').length/85)*15)):30;
    }
  });
  const footer=sheet.getRow(data.rows.length+9);footer.getCell(1).value=`Generado: ${limaDate(data.generated_at)} · Datos consultados en modo de solo lectura.`;
  footer.font={size:10,color:{argb:'FF64748B'}};
  sheet.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,paperSize:9};
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function renderWord(data:ReportData){
  const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,AlignmentType,Header,Footer,PageNumber}=await import('npm:docx@9.5.1');
  const cols=columns[data.dataset];const total=cols.reduce((n,c)=>n+c.width,0);
  const text=(value:string,bold=false)=>new Paragraph({spacing:{after:60},children:[new TextRun({text:value,bold,size:18,font:'Calibri'})]});
  const rows=[new TableRow({tableHeader:true,children:cols.map(col=>new TableCell({
    width:{size:col.width/total*100,type:WidthType.PERCENTAGE},shading:{fill:'1248C4'},
    children:[new Paragraph({children:[new TextRun({text:col.label,bold:true,color:'FFFFFF',size:18})]})],
  }))}),...data.rows.map((row,index)=>new TableRow({children:cols.map(col=>new TableCell({
    width:{size:col.width/total*100,type:WidthType.PERCENTAGE},shading:{fill:index%2?'F0F4FA':'FFFFFF'},
    children:String(displayCell(row[col.key],col)).split('\n').map(line=>text(line)),
  }))}))];
  const landscape=data.dataset!=='notes';
  const doc=new Document({creator:'Relámpago Courier',title:titles[data.dataset],
    styles:{default:{document:{run:{font:'Calibri',size:20},paragraph:{spacing:{after:100}}}}},
    sections:[{properties:{page:{size:{width:landscape?16838:11906,height:landscape?11906:16838},margin:{top:720,bottom:720,left:720,right:720}}},
      headers:{default:new Header({children:[new Paragraph({children:[new TextRun({text:'RELÁMPAGO COURIER',bold:true,color:'1248C4',size:20})]})]})},
      footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'Solo lectura · Página ',size:16}),new TextRun({children:[PageNumber.CURRENT],size:16})]})]})},
      children:[new Paragraph({spacing:{after:160},children:[new TextRun({text:titles[data.dataset],size:34,bold:true,color:'1248C4'})]}),
        text(period(data)),text(`Generado: ${limaDate(data.generated_at)} · ${data.rows.length} registros`,true),
        ...(data.dataset==='orders'?[text(`Importe total del servicio: S/ ${data.total_service_amount.toFixed(2)}`,true)]:[]),
        text(data.coverage),new Table({width:{size:100,type:WidthType.PERCENTAGE},rows}),
        ...(data.rows.length?[]:[text('No hay registros que cumplan estos filtros.')]),
      ]}]});
  return new Uint8Array(await Packer.toBuffer(doc));
}

async function renderPdf(data:ReportData){
  const [{PDFDocument,rgb},{default:fontkit},{notoSansBase64}]=await Promise.all([
    import('npm:pdf-lib@1.17.1'),import('npm:@pdf-lib/fontkit@1.1.1'),import('./report-font.ts'),
  ]);
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(Uint8Array.from(atob(notoSansBase64),c=>c.charCodeAt(0)),{subset:true});
  const supported=new Set(font.getCharacterSet());let substituted=false;
  const safe=(value:string)=>Array.from(value.replace(/\r/g,'')).map(c=>{
    if(c==='\n'||supported.has(c.codePointAt(0)!))return c;
    substituted=true;return `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`;
  }).join('');
  const cols=columns[data.dataset];const width=data.dataset==='notes'?595.28:841.89;const height=data.dataset==='notes'?841.89:595.28;
  const margin=30,usable=width-margin*2;const total=cols.reduce((sum,col)=>sum+col.width,0);const widths=cols.map(c=>usable*c.width/total);
  const size=8,lineHeight=11,padding=5;let page=doc.addPage([width,height]);let y=0;
  const wrap=(value:string,maxWidth:number,fontSize=size)=>{
    const lines:string[]=[];
    for(const paragraph of safe(value).split('\n')){
      let line='';
      for(const char of Array.from(paragraph)){
        if(line&&font.widthOfTextAtSize(line+char,fontSize)>maxWidth){lines.push(line);line=char;}else line+=char;
      }
      lines.push(line||' ');
    }
    return lines;
  };
  const draw=(text:string,x:number,top:number,fontSize=size,color=rgb(.12,.16,.23))=>page.drawText(safe(text),{x,y:top-fontSize,font,size:fontSize,color});
  const header=()=>{
    page.drawRectangle({x:0,y:height-54,width,height:54,color:rgb(.07,.28,.77)});
    draw(`RELÁMPAGO · ${titles[data.dataset]}`,margin,height-18,16,rgb(1,1,1));
    y=height-65;draw(period(data),margin,y,8);y-=16;
    draw(`${data.rows.length} registros · Generado: ${limaDate(data.generated_at)}`,margin,y,8);y-=15;
    if(data.dataset==='orders'){draw(`Importe total del servicio: S/ ${data.total_service_amount.toFixed(2)}`,margin,y,9);y-=16;}
    for(const line of wrap(data.coverage,usable,8)){draw(line,margin,y,8);y-=lineHeight;}
    y-=8;
    const labels=cols.map((c,i)=>wrap(c.label,widths[i]-padding*2));const h=Math.max(...labels.map(l=>l.length))*lineHeight+padding*2;
    page.drawRectangle({x:margin,y:y-h,width:usable,height:h,color:rgb(.9,.93,.98)});
    let x=margin;labels.forEach((lines,i)=>{lines.forEach((line,j)=>draw(line,x+padding,y-padding-j*lineHeight));x+=widths[i];});y-=h;
  };
  header();
  for(const [index,row]of data.rows.entries()){
    const values=cols.map((col,i)=>wrap(displayCell(row[col.key],col),widths[i]-padding*2));let offset=0;
    const length=Math.max(...values.map(v=>v.length));
    while(offset<length){
      let capacity=Math.floor((y-margin-22-padding*2)/lineHeight);
      if(capacity<1){page=doc.addPage([width,height]);header();capacity=Math.floor((y-margin-22-padding*2)/lineHeight);}
      const count=Math.min(capacity,length-offset);const h=count*lineHeight+padding*2;
      if(index%2===1)page.drawRectangle({x:margin,y:y-h,width:usable,height:h,color:rgb(.96,.97,.99)});
      let x=margin;values.forEach((lines,i)=>{lines.slice(offset,offset+count).forEach((line,j)=>draw(line,x+padding,y-padding-j*lineHeight));x+=widths[i];});
      page.drawLine({start:{x:margin,y:y-h},end:{x:width-margin,y:y-h},thickness:.4,color:rgb(.85,.88,.92)});
      y-=h;offset+=count;
    }
  }
  if(!data.rows.length)draw('No hay registros que cumplan estos filtros.',margin,y-12,10);
  const pages=doc.getPages();pages.forEach((p,i)=>p.drawText(`Solo lectura · ${i+1} / ${pages.length}`,{x:margin,y:16,font,size:7,color:rgb(.4,.45,.52)}));
  if(substituted)pages.at(-1)!.drawText('Símbolos sin glifo se muestran como [U+...].',{x:width/2,y:16,font,size:6});
  return await doc.save();
}
