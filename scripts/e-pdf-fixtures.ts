import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {exportTimingPdf} from '../lib/timing-pdf.ts';
import {schedule} from '../lib/schedule.ts';
import type {Task} from '../lib/schedule.ts';
import {schedulePolicy} from '../lib/timing-versions.ts';
const directory=resolve(process.argv[2]??'.deploy/batch-e-pdf');mkdirSync(directory,{recursive:true});
const cases:{name:string;tasks:Task[];title:string}[]=[];
const leaf=(id:string,parentId:string|null,order:number,title:string):Task=>({id,projectId:'pdf',parentId,order,title,kind:'task',owner:'Synthetic',start:'2026-11-16',end:null,duration:1,progress:33.3333333333333,status:'计划中',notes:'',predecessors:[]});
for(const depth of [1,3,15,16,20]){
 const tasks=Array.from({length:depth},(_,i)=>({...leaf('d'+i,i?'d'+(i-1):null,0,`L${String(i+1).padStart(2,'0')} `+'完整长名称验收'.repeat(27)),...(i===depth-1?{kind:'milestone' as const,duration:0}: {})}));
 cases.push({name:'depth-'+depth,tasks:schedule(tasks),title:'PDF 深层级名称、WBS 与行对齐验收'});
}
cases.push({name:'empty',tasks:[],title:'空计划验收'});
cases.push({name:'long-range',title:'长项目标题'.repeat(35),tasks:schedule([
 {...leaf('early',null,0,'开始里程碑'),kind:'milestone',duration:0,start:'2000-01-03'},
 ...Array.from({length:35},(_,i)=>({...leaf('long'+i,null,i+1,`跨度任务${i+1} `+'中英文 Long name / '.repeat(10)),duration:2600,start:'2026-11-16'})),
 {...leaf('late',null,99,'结束里程碑'),kind:'milestone',duration:0,start:'2100-12-31'},
 ])});
const manifest:{name:string;title:string;tasks:{id:string;title:string}[];bytes:number}[]=[];
for(const value of cases){const plan={format:1 as const,project:{id:'pdf',title:value.title,taskRevision:1} as any,tasks:value.tasks,schedulePolicy};const bytes=await exportTimingPdf(plan,null);writeFileSync(join(directory,value.name+'.pdf'),bytes);manifest.push({name:value.name,title:value.title,tasks:value.tasks.map(t=>({id:t.id,title:t.title})),bytes:bytes.length});}
writeFileSync(join(directory,'manifest.json'),JSON.stringify({method:'Legal schedule fixtures, depth1/3/15/16/20, long names <=200, empty, milestones, 2000–2100 full range; all PDFs require external rendering/text verification.',cases:manifest},null,2));console.log(directory);
