import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import type { PlanSnapshot,TimingVersion } from './timing-versions.ts';
import type { Task } from './schedule.ts';
import { cells,cellXml,patchCells,unpack,pack,textPart,putPart,strings,xml,unxml,attr,parser,list,col,translate } from './timing-xml.ts';
import { formulaEngine } from './timing-formulas.ts';
export const TEMPLATE=readFileSync(new URL('../assets/Timing_Sample_v3_Print.xlsx',import.meta.url));
export const CAPACITY=100;
export const HEADERS=['WBS','任务名称','负责人','输入开始','输入结束','工期(叶子)','输入完成度','前置任务 WBS','叶子类型','操作','实际类型','层级','生效开始','生效结束','生效完成度','填写检查'];
export const excelDate=(date:string)=>Date.parse(date+'T00:00:00Z')/86400000+25569;
export const calendarDate=(serial:number)=>new Date((serial-25569)*86400000).toISOString().slice(0,10);
export const shanghaiDate=(instant=new Date())=>instant.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
export function orderedTasks(tasks:Task[]){
 const result:{task:Task;wbs:string;depth:number}[]=[];
 function visit(parent:string|null,prefix:string,depth:number){tasks.filter(t=>t.parentId===parent).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)).forEach((task,i)=>{const wbs=prefix?`${prefix}.${i+1}`:String(i+1);result.push({task,wbs,depth});visit(task.id,wbs,depth+1);});}
 visit(null,'',1);if(result.length!==tasks.length)throw Error('计划存在无法表示的层级');return result;
}
const sign=(key:string,value:string)=>createHmac('sha256',key).update(value).digest('base64url');
export type WorkbookSource={format:1;projectId:string;revision:number;projectVersion:number;versionId:string;statusDate:string;token:string};
export function exportWorkbook(plan:PlanSnapshot,version:TimingVersion|null,key:string){
 const rows=orderedTasks(plan.tasks);if(rows.length>CAPACITY)throw Object.assign(Error(`原模板计算容量为 ${CAPACITY} 项；本计划 ${rows.length} 项，无法无损导出。未截断任务。`),{status:400});
 if(rows.some(r=>r.depth>3))throw Object.assign(Error('原模板仅支持三级任务，无法无损导出更深层级。'),{status:400});
 const editEnd=Math.max(29,rows.length+9);
 const parts=unpack(TEMPLATE),ss=strings(parts),names=['Timing浏览','任务编辑','排期计算'],sources=names.map((_,i)=>textPart(parts,`xl/worksheets/sheet${i+1}.xml`)),maps=sources.map(s=>cells(s,ss));
 const statusDate=version?version.savedAt.slice(0,10):shanghaiDate();
 const source:WorkbookSource={format:1,projectId:plan.project.id,revision:version?.revision??plan.project.taskRevision,projectVersion:version?.projectVersion??plan.project.version,versionId:version?.id??'current',statusDate,token:''};
 source.token=sign(key,JSON.stringify({...source,token:''}));
 const set=(sheet:number,ref:string,value:string|number,formula?:string)=>{let c=maps[sheet].get(ref);if(!c){const prototype=maps[sheet].get(ref.replace(/\d/g,'')+'10');c={ref,attrs:prototype?prototype.attrs.replace(/\br="[^"]*"/,`r="${ref}"`):` r="${ref}"`,raw:'',value:''};}maps[sheet].set(ref,{...c,value,formula});};
 // Expand every calculated column into ordinary formulas. This removes stale
 // shared-formula caches without changing any style, validation or protection.
 for(let r=10;r<=109;r++){
  if(r<=editEnd)for(const c of ['F','K','L','M','N','O','P']){const original=maps[1].get(c+r)??maps[1].get(c+'10')!;set(1,c+r,'',original.formula);}
  for(let c=1;c<=33;c++){const letter=col(c),original=maps[2].get(letter+r)??maps[2].get(letter+'10')!;if(letter==='AF')set(2,letter+r,'');else set(2,letter+r,'',original.formula??translate(maps[2].get(letter+'10')!.formula!,letter+'10',letter+r));}
  if(r<=editEnd){for(const c of ['A','B','C','D','E','G','H','I','J'])set(1,c+r,'');
   // Reuse the template's existing text-input style. Its font/fill/border and
   // alignment equal H's style; @ prevents a locally entered 1.10 becoming 1.1.
   const h=maps[1].get('H'+r)!;h.attrs=h.attrs.replace(/\bs="\d+"/,'s="20"');
  }
 }
 const wbsById=new Map(rows.map(r=>[r.task.id,r.wbs]));
 rows.forEach(({task:t,wbs},i)=>{
  const r=i+10;
  for(const [c,value] of Object.entries({A:wbs,B:t.title,C:t.owner,D:t.kind==='summary'?'':t.start?excelDate(t.start):'',E:t.kind==='summary'?'':t.end?excelDate(t.end):'',G:t.kind==='summary'?0:t.progress/100,H:t.predecessors.map(id=>{const w=wbsById.get(id);if(!w)throw Error('前置任务不存在');return w;}).join(', '),I:t.kind==='milestone'?'里程碑':'普通任务',J:'保留'}))set(1,c+r,value);
 });
 set(0,'A2',plan.project.title+' 项目排期');set(1,'A2',plan.project.title+' · 任务编辑');
 set(1,'A5','按 WBS 父子关系汇总；空日期一级项作为汇总，填写日期的无下级项按叶子类型计算。');
 set(0,'B4',excelDate(statusDate)); // Same fixed UTC snapshot-date convention as D1.
 for(const c of maps[0].values())if(c.formula)c.formula=c.formula.replaceAll('TODAY()','$B$4');
 set(0,'B5',rows.find(r=>r.task.start)?.task.start?excelDate(rows.find(r=>r.task.start)!.task.start!):excelDate(statusDate));
 const dates=rows.flatMap(r=>r.task.start&&r.task.end?[excelDate(r.task.start),excelDate(r.task.end)]:[]);
 if(dates.length&&Math.max(...dates)-Math.min(...dates)>650)set(0,'B3','全项目');
 // The website supports root leaves. Keep the template's blank-root summary
 // behavior, but let dated root tasks and milestones remain leaves.
 for(let r=10;r<=109;r++){
  const k=maps[2].get('K'+r)!;k.formula=k.formula!.replace(`L${r}=1,`,`AND(L${r}=1,D${r}="",E${r}="",I${r}<>"里程碑"),`);
  const o=maps[2].get('O'+r)!;
  // Round only at the displayed summary, weighting all descendants' unrounded
  // leaf progress just as schedule.ts does. Keep input percentages unchanged.
  const original=o.formula!;o.formula=`IF(K${r}="汇总",ROUND((${original})*100,0)/100,${original})`;
 }
 const calcMap=new Map<string,any>(),visiting=new Set<string>();
 const tableEnd=editEnd;
 const get=(sheet:string,ref:string):any=>{
  const id=sheet+'!'+ref;if(calcMap.has(id))return calcMap.get(id);
  const map=maps[names.indexOf(sheet)];if(!map)throw Error('未知模板工作表 '+sheet);const c=map.get(ref);if(!c)return '';
  if(visiting.has(id))throw Error('模板公式循环 '+id);visiting.add(id);
  let value:any=c.formula?evaluate(c.formula,sheet,+ref.replace(/\D/g,'')):c.value;
  if(typeof value==='number'&&!Number.isFinite(value))throw Error('模板计算错误 '+id);visiting.delete(id);calcMap.set(id,value);return value;
 };
 const evaluate=formulaEngine(get,(column,row)=>{
  const index=HEADERS.indexOf(column);if(index<0)throw Error('未知模板字段 '+column);return row?[get('任务编辑',col(index+1)+row)]:Array.from({length:tableEnd-9},(_,i)=>get('任务编辑',col(index+1)+(i+10)));
 },excelDate(statusDate));
 for(let si=0;si<3;si++)for(const [ref,c] of maps[si])if(c.formula)c.value=get(names[si],ref);
 // Prove cached AND recalculated outputs agree with the selected saved data.
 // A historical policy mismatch is reported rather than rewriting a snapshot.
 rows.forEach(({task:t},i)=>{
  const r=i+10,actual=[get(names[2],'K'+r),get(names[2],'M'+r),get(names[2],'N'+r),get(names[2],'O'+r)],expected=[t.kind==='summary'?'汇总':t.kind==='milestone'?'里程碑':'普通任务',t.start?excelDate(t.start):'',t.end?excelDate(t.end):'',t.progress/100];
  const duration=get('Timing浏览','E'+r);
  if((duration===''?0:duration)!==t.duration||actual.some((x,j)=>typeof x==='number'&&typeof expected[j]==='number'?Math.abs(x-Number(expected[j]))>1e-9:x!==expected[j]))throw Object.assign(Error(`任务「${t.title}」的保存结果与模板计算规则不一致，无法无损导出（类型/日期/工期/进度）。请使用 PDF 查看原始保存数据。`),{status:400});
 });
 for(let i=0;i<3;i++)putPart(parts,`xl/worksheets/sheet${i+1}.xml`,patchCells(sources[i],maps[i]));
 let edit=textPart(parts,'xl/worksheets/sheet2.xml');
 // Existing-style, internal self hyperlinks carry signed identities on the
 // calculated check cells, which users do not overwrite when editing inputs.
 // Excel moves these cell objects on table sorting/insertion; there is no extra
 // visible column or worksheet. Missing carriers require explicit user mapping.
 const links=rows.map(({task},i)=>{const payload=Buffer.from(JSON.stringify({projectId:source.projectId,source:source.token,id:task.id})).toString('base64url');return `<hyperlink ref="P${i+10}" location="'任务编辑'!P${i+10}" tooltip="PS1.${payload}.${sign(key,payload)}"/>`;}).join('');
 edit=edit.replace('<pageMargins',`<hyperlinks>${links}</hyperlinks><pageMargins`).replace(/sqref="A10:P29"/g,`sqref="A10:P${editEnd}"`).replace(/sqref="P10:P29"/g,`sqref="P10:P${editEnd}"`);
 putPart(parts,'xl/worksheets/sheet2.xml',edit);
 putPart(parts,'xl/tables/table1.xml',textPart(parts,'xl/tables/table1.xml').replaceAll('A9:P29',`A9:P${editEnd}`));
 const ends=rows.flatMap(r=>r.task.end?[excelDate(r.task.end)]:[]),lastEnd=ends.length?Math.max(...ends):excelDate(statusDate);
 let lastColumn=11;while(lastColumn<106&&Number(get('Timing浏览',col(lastColumn)+'6'))<lastEnd)lastColumn++;
 let workbook=textPart(parts,'xl/workbook.xml').replace(/<calcPr[^>]*\/>/,'<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>').replace(/Timing浏览!\$A\$1:\$W\$28/g,`Timing浏览!$A$1:$${col(lastColumn)}$${Math.max(10,rows.length+9)}`);
 workbook=workbook.replace('</definedNames>','<definedName name="_xlnm.Print_Titles" localSheetId="0">Timing浏览!$7:$9,Timing浏览!$A:$G</definedName></definedNames>');
 putPart(parts,'xl/workbook.xml',workbook);
 delete parts['xl/calcChain.xml'];putPart(parts,'xl/_rels/workbook.xml.rels',textPart(parts,'xl/_rels/workbook.xml.rels').replace(/<Relationship\b[^>]*Type="[^"]*calcChain"[^>]*\/>/g,''));
 // All cell strings are now inline; remove unused sample strings and sample IDs.
 delete parts['xl/sharedStrings.xml'];putPart(parts,'xl/_rels/workbook.xml.rels',textPart(parts,'xl/_rels/workbook.xml.rels').replace(/<Relationship\b[^>]*Type="[^"]*sharedStrings"[^>]*\/>/g,''));
 putPart(parts,'[Content_Types].xml',textPart(parts,'[Content_Types].xml').replace(/<Override\b[^>]*PartName="\/xl\/(?:calcChain|sharedStrings).xml"[^>]*\/>/g,'').replace('</Types>','<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'));
 putPart(parts,'_rels/.rels',textPart(parts,'_rels/.rels').replace('</Relationships>','<Relationship Id="psSource" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>'));
 putPart(parts,'docProps/custom.xml',`<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ProjectStationTiming"><vt:lpwstr>${xml(JSON.stringify(source))}</vt:lpwstr></property></Properties>`);
 return {buffer:pack(parts),source};
}
export type InputRow={row:number;wbs:string;title:string;owner:string;start:string|null;end:string|null;progress:number;predecessors:string[];kind:'task'|'milestone';operation:string;identity?:string;raw:Record<string,any>};
export type InputIssue={sheet:string;row:number;field:string;message:string};
export function readWorkbook(data:Buffer,key:string){
 const issues:InputIssue[]=[],rows:InputRow[]=[];let parts:ReturnType<typeof unpack>;
 try{parts=unpack(data);}catch{throw Object.assign(Error('无法读取 Excel：仅接受未加密的原框架 .xlsx，最大 8 MB。'),{status:400});}
 const book=parser.parse(textPart(parts,'xl/workbook.xml'))?.workbook,rels=list(parser.parse(textPart(parts,'xl/_rels/workbook.xml.rels'))?.Relationships?.Relationship);
 const sheets=list(book?.sheets?.sheet),entry=sheets.find(s=>s['@name']==='任务编辑');if(!entry)throw Object.assign(Error('缺少“任务编辑”工作表'),{status:400});
 const target=rels.find(r=>r['@Id']===entry['@r:id'])?.['@Target'];if(typeof target!=='string')throw Error('工作表关系无效');
 const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,''),sourceXml=textPart(parts,path),map=cells(sourceXml,strings(parts));
 for(let i=0;i<HEADERS.length;i++)if(map.get(col(i+1)+'9')?.value!==HEADERS[i])issues.push({sheet:'任务编辑',row:9,field:col(i+1),message:`表头须为「${HEADERS[i]}」`});
 let source:WorkbookSource|undefined;
 try{const properties=list(parser.parse(textPart(parts,'docProps/custom.xml'))?.Properties?.property),p=properties.find(p=>p['@name']==='ProjectStationTiming');const value=JSON.parse(p?.['vt:lpwstr']);if(value.format===1&&sign(key,JSON.stringify({...value,token:''}))===value.token)source=value;}catch{}
 const identities=new Map<string,string>();
 for(const link of sourceXml.matchAll(/<hyperlink\b([^>]*?)\/>/g)){
  const token=attr(link[1],'tooltip'),m=/^PS1\.([\w-]+)\.([\w-]+)$/.exec(token);if(!m||!source||sign(key,m[1])!==m[2])continue;
  try{const payload=JSON.parse(Buffer.from(m[1],'base64url').toString());if(payload.projectId===source.projectId&&payload.source===source.token)identities.set(attr(link[1],'ref'),payload.id);}catch{}
 }
 const rowNumbers=[...new Set([...map.keys()].map(r=>+r.replace(/\D/g,'')).filter(r=>r>=10))].sort((a,b)=>a-b);
 const issue=(row:number,field:string,message:string)=>issues.push({sheet:'任务编辑',row,field,message});
 for(const row of rowNumbers){
  const v=(c:string)=>map.get(c+row)?.value??'';if(!['A','B','C','D','E','G','H','I','J'].some(c=>v(c)!==''))continue;
  // Empty preformatted rows may contain default dropdown/zero values.
  if(v('A')===''&&v('B')===''&&['C','D','E','H'].every(c=>v(c)==='')&&Number(v('G'))===0)continue;
  const wbs=String(v('A')).trim(),title=String(v('B')).trim();
  for(const c of ['A','B','C','D','E','G','H','I','J'])if(map.get(c+row)?.formula)issue(row,HEADERS['ABCDEFGHIJKLMNOP'.indexOf(c)],'输入字段不能使用公式；请粘贴为值。计算区会由网站重新计算。');
  if(!/^[1-9]\d{0,2}(?:\.[1-9]\d{0,2}){0,2}$/.test(wbs))issue(row,'WBS','须为 1–3 级正整数文本（每段 1–999）');
  if(!title||title.length>200)issue(row,'任务名称','须为 1–200 字');if(String(v('C')).length>100)issue(row,'负责人','最多 100 字');
  function date(c:string){const value=v(c);if(value==='')return null;let d:string;try{d=typeof value==='number'?calendarDate(value):String(value);if(typeof value==='number'&&!Number.isInteger(value))throw Error();if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||d<'2000-01-01'||d>'2100-12-31'||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error();return d;}catch{issue(row,c==='D'?'输入开始':'输入结束','须为有效 Excel 日期或 YYYY-MM-DD，2000–2100 年');return null;}}
  const start=date('D'),end=date('E'),progress=v('G')===''?0:Number(v('G')),kind=v('I')==='里程碑'?'milestone':'task',operation=String(v('J')||'保留');
  if(!Number.isFinite(progress)||progress<0||progress>1)issue(row,'输入完成度','请输入 0–100%（底层值须为 0–1）');
  if(!['','普通任务','里程碑'].includes(String(v('I'))))issue(row,'叶子类型','请选择普通任务或里程碑');if(!['保留','删除'].includes(operation))issue(row,'操作','请选择保留或删除');
  if(start&&end&&end<start)issue(row,'输入结束','结束早于开始');
  rows.push({row,wbs,title,owner:String(v('C')),start,end,progress:progress*100,predecessors:String(v('H')).split(/[,，;；\s]+/).filter(Boolean),kind,operation,identity:identities.get('P'+row),raw:Object.fromEntries(['A','B','C','D','E','G','H','I','J'].map(c=>[c,v(c)]))});
 }
 if(rows.length>CAPACITY)issue(10,'WBS',`超出原模板 ${CAPACITY} 项计算容量；未截断任务`);
 if(book?.workbookPr?.['@date1904']==='1')issue(9,'日期系统','不接受 1904 日期系统，请保留原模板的 1900 日期系统');
 return {rows,issues,source};
}
