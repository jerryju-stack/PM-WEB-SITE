// Isolated browser-QA data. Never opens the production database.
import { openStore } from '../lib/database.ts';
import { template } from '../lib/schedule.ts';
import type { Task } from '../lib/schedule.ts';
import { resolve } from 'node:path';
process.env.ADMIN_PASSWORD='Preview-Only-2026';
const store=openStore(resolve('data/preview-fixture'));
if(!store.get('projects','preview')){
 store.put('projects',{id:'preview',title:'APQP 新产品导入 · 验证项目',description:'用于本地功能验证的隔离项目：从客户节点到量产交付。',category:'汽车项目管理',owner:'项目经理',startDate:'2026-10-12',date:'2027-02-26',status:'进行中',progress:0});
 const tasks=template('preview');
 const add=(id:string,stage:number,title:string,start:string,duration:number,progress:number,predecessors:string[]=[],kind:Task['kind']='task')=>tasks.push({id,projectId:'preview',parentId:`preview-stage-${stage}`,order:tasks.filter(t=>t.parentId===`preview-stage-${stage}`).length,title,kind,owner:['项目经理','研发负责人','质量负责人'][stage%3],start,end:null,duration,progress,status:'计划中',notes:'浏览器验证专用任务，不影响正式项目数据。',predecessors});
 add('customer-target',1,'客户目标节点确认','2026-10-12',5,100);
 add('customer-approval',1,'客户需求冻结','2026-10-20',0,0,['customer-target'],'milestone');
 add('rfq-review',2,'技术可行性评估','2026-10-19',5,40);
 add('rfq-cost',2,'报价与成本评审','2026-10-26',4,0,['rfq-review']);
 add('kickoff',3,'跨部门项目启动会','2026-11-02',0,0,['rfq-cost'],'milestone');
 add('cv-plan',4,'概念设计与样件开发','2026-11-03',10,0,['kickoff']);
 add('dv-test',5,'设计验证与测试','2026-11-17',10,0,['cv-plan']);
 add('pv-trial',6,'过程验证与试生产','2026-12-01',10,0,['dv-test']);
 add('ppap-submit',7,'生产件批准资料提交','2026-12-15',5,0,['pv-trial']);
 add('sop-release',8,'量产批准','2026-12-22',0,0,['ppap-submit'],'milestone');
 store.saveTasks('preview',tasks);
}
store.db.close();console.log('Isolated QA fixture ready: data/preview-fixture');
