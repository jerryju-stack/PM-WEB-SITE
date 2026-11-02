import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { PlanSnapshot } from './timing-versions.ts';
import type { InputRow, InputIssue, WorkbookSource } from './timing-workbook.ts';
import { orderedTasks } from './timing-workbook.ts';
import { xml, list } from './timing-xml.ts';
import { dateValue, workdays } from './schedule.ts';

const NS='http://schemas.microsoft.com/project';
const tag=(name:string,value:unknown)=>`<${name}>${xml(value)}</${name}>`;
const bad=(message:string):never=>{throw Object.assign(Error(message),{status:400});};
const yes=(value:unknown)=>value==='1'||value==='true';

// MSPDI durations are working hours, not calendar-day spans. One website day is 8h.
export function exportProjectXml(plan:PlanSnapshot){
 const rows=orderedTasks(plan.tasks),uid=new Map(rows.map((r,i)=>[r.task.id,i+1]));
 if(rows.length>1000||rows.some(r=>r.depth>20))bad('Project XML 最多支持 1000 项任务、20 级层级；未截断任务');
 const days=Array.from({length:7},(_,i)=>`<WeekDay><DayType>${i+1}</DayType><DayWorking>${i>0&&i<6?1:0}</DayWorking>${i>0&&i<6?'<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>':''}</WeekDay>`).join('');
 const tasks=rows.map(({task:t,wbs,depth},i)=>`<Task>${tag('UID',i+1)}${tag('ID',i+1)}${tag('Name',t.title)}${tag('Type',1)}${tag('IsNull',0)}${tag('Contact',t.owner)}${tag('WBS',wbs)}${tag('OutlineNumber',wbs)}${tag('OutlineLevel',depth)}${t.start?tag('Start',t.start+'T08:00:00'):''}${t.end?tag('Finish',t.end+(t.kind==='milestone'?'T08:00:00':'T17:00:00')):''}${tag('Duration',`PT${t.duration*8}H0M0S`)}${tag('DurationFormat',7)}${tag('Milestone',t.kind==='milestone'?1:0)}${tag('Summary',t.kind==='summary'?1:0)}${tag('PercentComplete',Math.round(t.progress))}${tag('ConstraintType',t.start&&t.kind!=='summary'?4:0)}${tag('CalendarUID',1)}${t.start&&t.kind!=='summary'?tag('ConstraintDate',t.start+'T08:00:00'):''}${tag('Notes',t.notes)}${t.predecessors.map(id=>{const n=uid.get(id);if(!n)bad('前置任务不存在');return `<PredecessorLink>${tag('PredecessorUID',n)}<Type>1</Type><CrossProject>0</CrossProject><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`;}).join('')}</Task>`).join('');
 return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Project xmlns="${NS}"><SaveVersion>14</SaveVersion>${tag('Name',plan.project.title)}${tag('Title',plan.project.title)}<ScheduleFromStart>1</ScheduleFromStart>${plan.project.startDate?tag('StartDate',plan.project.startDate+'T08:00:00'):''}<CalendarUID>1</CalendarUID><DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime><MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth><DurationFormat>7</DurationFormat><Calendars><Calendar><UID>1</UID><Name>Timing Monday-Friday</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${days}</WeekDays></Calendar></Calendars><Tasks>${tasks}</Tasks></Project>`);
}

export function readProjectXml(data:Uint8Array):{rows:InputRow[];issues:InputIssue[];source?:WorkbookSource;warnings:string[]}{
 if(data.length>8*1024*1024)bad('Project XML 文件不能超过 8 MB');
 let text:string;
 try{text=new TextDecoder(data[0]===255&&data[1]===254?'utf-16le':data[0]===254&&data[1]===255?'utf-16be':'utf-8',{fatal:true}).decode(data);}catch{bad('Project XML 编码无效，请使用 UTF-8 或带 BOM 的 UTF-16');}
 if(/<!DOCTYPE|<!ENTITY/i.test(text!))bad('Project XML 不允许 DTD 或实体声明');
 if(XMLValidator.validate(text!)!==true)bad('Project XML 文件格式无效');
 const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',parseTagValue:false,trimValues:false});
 const doc=parser.parse(text!),rootName=Object.keys(doc).find(k=>!k.startsWith('?'))??'',root=doc[rootName],prefix=rootName.includes(':')?rootName.split(':')[0]+':':'';
 if(rootName!==prefix+'Project'||root?.['@xmlns'+(prefix?':'+prefix.slice(0,-1):'')]!==NS)bad('请选择 Microsoft Project XML（MSPDI），不支持原生 .mpp 或普通 XML');
 // Normalize only the root namespace's prefix, preserving scalar text values.
 const normalize=(v:any):any=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[prefix&&k.startsWith(prefix)?k.slice(prefix.length):k,normalize(x)])):v;
 const p=normalize(root),all=list(p.Tasks?.Task).filter(t=>!yes(t.IsNull)),items=all.filter(t=>String(t.OutlineLevel??'')!=='0');
 if(!items.length||items.length>1000)bad('Project XML 须包含 1–1000 项任务（不含项目汇总行）');
 const rows:InputRow[]=[],issues:InputIssue[]=[],warnings=['按文件中的日期导入；网站按周一至周五、整工作日及 FS 次工作日规则重新排期。时分秒、资源分配、成本、约束及自定义日历不导入，请核对最终日期。','Project UID 仅用于解析文件内依赖；网站任务按 WBS 匹配，可手动调整匹配。'];
 const issue=(row:number,field:string,message:string)=>issues.push({sheet:'Project XML',row,field,message});
 const scalar=(v:any)=>typeof v==='string'?v:typeof v==='number'?String(v):v===undefined?'':'';
 const uids=new Map<string,InputRow>(),levels:number[]=[];
 const minutes=Number(p.MinutesPerDay??480);
 if(!Number.isFinite(minutes)||minutes<=0)bad('Project XML 的 MinutesPerDay 无效');
 items.forEach((t,i)=>{
  const row=i+1,level=Number(t.OutlineLevel??scalar(t.OutlineNumber).split('.').length);
  if(!Number.isInteger(level)||level<1||level>20||level>levels.length+1){issue(row,'层级','OutlineLevel 无效或跳级');return;}
  levels.length=level;levels[level-1]=(levels[level-1]??0)+1;
  const generated=levels.join('.'),outline=scalar(t.OutlineNumber),wbs=/^[1-9]\d*(?:\.[1-9]\d*)*$/.test(outline)?outline:generated;
  if(outline&&outline!==wbs||t.WBS!==undefined&&scalar(t.WBS)!==wbs)warnings.push(`任务 ${row}：自定义 WBS/大纲编码按层级转换为 ${wbs}。`);
  if(wbs.split('.').length!==level)issue(row,'层级','OutlineNumber 与 OutlineLevel 不一致');
  const date=(v:any,field:string)=>{if(v===undefined||v==='')return null;const s=scalar(v);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(s)||!Number.isFinite(Date.parse(s))){issue(row,field,'日期时间格式无效');return null;}try{dateValue(s.slice(0,10));return s.slice(0,10);}catch(e:any){issue(row,field,e.message);return null;}};
  const start=date(t.Start,'开始'),end=date(t.Finish,'结束'),summary=yes(t.Summary),milestone=yes(t.Milestone),progress=Number(t.PercentComplete??0),title=scalar(t.Name);
  if(!title.trim()||title.length>200)issue(row,'任务名称','名称不能为空且最多 200 字');
  if(!Number.isFinite(progress)||progress<0||progress>100)issue(row,'完成度','须在 0–100 之间');
  if(start&&end&&end<start)issue(row,'日期','结束日期不能早于开始日期');
  const input:InputRow={row,wbs,title,owner:scalar(t.Contact),start:summary?null:start,end:summary?null:end,progress,predecessors:[],kind:milestone?'milestone':'task',operation:'保留',raw:{projectSummary:summary,...(t.Notes===undefined?{}:{notes:scalar(t.Notes)})}};
  const id=scalar(t.UID);if(!/^\d+$/.test(id)||uids.has(id))issue(row,'UID','任务 UID 缺失、无效或重复');else uids.set(id,input);
  if(t.Duration!==undefined){
   const d=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(scalar(t.Duration));
   if(!d||!d.slice(1).some(x=>x!==undefined))issue(row,'工期','须为 MSPDI 时间段，例如 PT8H0M0S');
   else if(!summary&&start&&end&&end>=start){const days=(Number(d[1]??0)*1440+Number(d[2]??0)*60+Number(d[3]??0)+Number(d[4]??0)/60)/minutes;try{if(Math.abs(days-(milestone?0:workdays(start,end)))>0.0001)warnings.push(`任务 ${row}：文件工期 ${days} 天与网站日期范围不同，按网站工作日重算。`);}catch{}}
  }
  rows.push(input);
 });
 items.forEach((t,i)=>{const row=rows.find(r=>r.row===i+1);if(!row)return;for(const link of list(t.PredecessorLink)){
  const predecessor=uids.get(scalar(link.PredecessorUID));
  if(!predecessor)issue(row.row,'前置任务','PredecessorUID 无法解析');else row.predecessors.push(predecessor.wbs);
  if(String(link.Type??'1')!=='1'||Number(link.LinkLag??0)!==0||yes(link.CrossProject))issue(row.row,'前置任务','仅支持项目内、无延迟的 FS 依赖');
 }});
 return {rows,issues,warnings};
}
