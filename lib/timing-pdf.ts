import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import type { PlanSnapshot,TimingVersion } from './timing-versions.ts';
import { orderedTasks,shanghaiDate } from './timing-workbook.ts';
const DAY=86400000,date=(s:string)=>Date.parse(s+'T00:00:00Z'),iso=(n:number)=>new Date(n).toISOString().slice(0,10);
export async function exportTimingPdf(plan:PlanSnapshot,version:TimingVersion|null){
 const rows=orderedTasks(plan.tasks),statusDate=version?version.savedAt.slice(0,10):shanghaiDate(),statusTime=date(statusDate);
 const dated=rows.flatMap(r=>{const a=r.task.start?date(r.task.start):NaN,b=r.task.end?date(r.task.end):NaN;return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?[a,b]:[];});
 let start=dated.length?Math.min(...dated):statusTime,end=dated.length?Math.max(...dated):start;
 const padding=Math.max(1,Math.ceil(((end-start)/DAY+1)*.025));start-=padding*DAY;end+=(padding+1)*DAY;
 // D6: every vertical page shows the whole project, with readable sparse labels.
 const span=end-start,columns=Math.min(8,Math.max(1,Math.ceil(span/(7*DAY)))),interval=span/columns;
 const W=1190.55,H=841.89,margin=26,left=610,gridX=margin+left,gridW=W-2*margin-left,tick=gridW/columns;
 const doc=new PDFDocument({size:'A3',layout:'landscape',margin:0,autoFirstPage:false,info:{Title:plan.project.title+' Timing Plan',Author:'Project Station',Subject:version?version.name:`当前计划 修订 ${plan.project.taskRevision}`}});
 const chunks:Buffer[]=[];doc.on('data',chunk=>chunks.push(chunk));const done=new Promise<Buffer>((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.registerFont('zh',fileURLToPath(new URL('../assets/fonts/NotoSansCJKsc-Regular.otf',import.meta.url)));doc.font('zh');
 const widths=[38,162,78,78,40,46,68],heads=['WBS','任务名称','计划开始','计划完成','工期','完成度','状态'];
 // The name column wraps rather than dropping characters. Row height is shared
 // by the task table and Gantt, and measured before pagination.
 const measured=rows.map(r=>{doc.fontSize(9);const indent=(r.depth-1)*10;return {...r,height:Math.max(26,doc.heightOfString(r.task.title,{width:widths[1]-12-indent})+12)};});
 const vertical:typeof measured[]=[];let batch:typeof measured=[],height=0;
 for(const row of measured){if(height+row.height>H-200&&batch.length){vertical.push(batch);batch=[];height=0;}batch.push(row);height+=row.height;}
 if(batch.length||!vertical.length)vertical.push(batch);
 const windows=1,total=vertical.length;
 const text=(s:string,x:number,y:number,width:number,size=9,color='#303247',align:'left'|'center'|'right'='left')=>{doc.font('zh').fontSize(size).fillColor(color).text(s,x,y,{width,align,lineBreak:false});};
 let page=0;
 for(let window=0;window<windows;window++)for(const section of vertical){
  doc.addPage();page++;const ws=start,we=end;
  text(plan.project.title+' 项目排期',margin,19,W-2*margin,17);
  const versionLabel=version?`${version.kind==='version'?'V'+version.sequence:version.kind==='baseline'?'基线':'最终版本'} · ${version.name} · 来源修订 ${version.revision}`:`当前计划 · 修订 ${plan.project.taskRevision}`;
  text(versionLabel,margin,47,W-2*margin,10);text(`状态日期 ${statusDate}（固定）    ${iso(ws)} 至 ${iso(we-DAY)}`,margin,65,W-2*margin,9,'#64677d');
  const top=87,headerH=51;doc.rect(margin,top,W-margin*2,headerH).fill('#303247');
  let x=margin;heads.forEach((h,i)=>{text(h,x+3,top+19,widths[i]-6,9,'#ffffff',i===1?'left':'center');x+=widths[i];});
  text('全项目',gridX,top+3,gridW,9,'#ffffff','center');
  const firstYear=new Date(ws).getUTCFullYear(),lastYear=new Date(we-DAY).getUTCFullYear();
  text(firstYear===lastYear?`${firstYear}年`:`${firstYear}年 - ${lastYear}年`,gridX,top+19,gridW,8,'#ffffff','center');
  for(let i=0;i<columns;i++){const d=iso(ws+i*interval);text(span>60*DAY?d.slice(0,7).replace('-','/'):d.slice(5).replace('-','/'),gridX+i*tick,top+35,tick,8,'#ffffff','center');}
  let y=top+headerH;
  for(const {task:t,wbs,depth,height:h} of section){
   const summary=t.kind==='summary',late=!!t.end&&t.end<statusDate&&t.progress<100,done=t.progress>=100;
   if(summary)doc.rect(margin,y,W-2*margin,h).fill('#efecfa');
   doc.strokeColor('#eeedf3').lineWidth(.35).moveTo(margin,y+h).lineTo(W-margin,y+h).stroke();
   let cx=margin;const status=t.start&&t.end?(done?'已完成':late?'逾期':t.status==='已暂停'?'已暂停':t.start>statusDate?'未开始':'进行中'):'未排期';
   const values=[wbs,t.title,t.start??'未排期',t.end??'未排期',String(t.duration),`${t.progress}%`,status];
   values.forEach((v,i)=>{if(i===1){doc.fontSize(9).fillColor('#303247').text(v,cx+6+(depth-1)*10,y+6,{width:widths[i]-12-(depth-1)*10,height:h-8});}else text(v,cx+2,y+(h-12)/2,widths[i]-4,i===0?8:9,late?'#b94350':'#303247',i===0?'left':'center');cx+=widths[i];});
   for(let i=0;i<=columns;i++)doc.strokeColor('#e8e7ef').lineWidth(.3).moveTo(gridX+i*tick,y).lineTo(gridX+i*tick,y+h).stroke();
   if(t.start&&t.end&&Number.isFinite(date(t.start))&&Number.isFinite(date(t.end))&&date(t.end)>=date(t.start)){const a=date(t.start),b=date(t.end)+DAY,px=gridX+(a-ws)/interval*tick,pw=(b-a)/interval*tick,color=done?'#4c9b7d':late?'#c64e5c':summary?'#303247':'#7d68ce';
    if(a<we&&b>ws){if(t.kind==='milestone'){const center=Math.max(gridX+5,Math.min(gridX+gridW-5,px+DAY/interval*tick/2)),cy=y+h/2;doc.polygon([center,cy-5],[center+5,cy],[center,cy+5],[center-5,cy]).fill(color);}else{const bx=Math.max(gridX,px),bw=Math.min(gridX+gridW,px+Math.max(2,pw))-bx;doc.rect(bx,y+7,bw,h-14).fill(color);if(!done&&!summary&&t.progress>0)doc.rect(bx,y+7,bw*t.progress/100,h-14).fill('#4c9b7d');}}
   }y+=h;
  }
  if(statusTime>=ws&&statusTime<we){const sx=gridX+(statusTime-ws)/interval*tick;doc.strokeColor('#d69c36').lineWidth(.8).moveTo(sx,top+33).lineTo(sx,y).stroke();}
  text('周一至周五 · 工期为工作日 · 历史数据使用保存快照',margin,H-34,700,8,'#77798b');text(`${page} / ${total}    全项目`,W-270,H-34,244,8,'#77798b','right');
 }
 doc.end();return done;
}
