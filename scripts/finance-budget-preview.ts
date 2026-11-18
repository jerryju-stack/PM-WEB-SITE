/** Runs the normal website against two isolated P12 demonstration projects. */
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {openStore} from '../lib/database.ts';
import {accountService} from '../lib/accounts.ts';
import {financeService} from '../lib/finance.ts';
import {policy} from '../lib/policy.ts';
import {template} from '../lib/schedule.ts';
import {p12Scenario,p12Range,t6Policy,t6Scope,t6Allocation,t6Confirm,t6Cost,t6Forecast} from '../tests/fixtures/finance-p12.ts';

const root=resolve('.deploy/finance-p12'),index=join(root,'latest-run.json');
let data:string;
if(process.argv.includes('--reuse'))data=JSON.parse(readFileSync(index,'utf8')).data;
else {
  const directory=join(root,'run-'+new Date().toISOString().replace(/[:.]/g,'-'));
  const credentials=join(directory,'local-login.json');
  data=join(directory,'data');
  mkdirSync(directory,{recursive:true});
  const password=()=>randomBytes(24).toString('base64url');
  const logins={admin:{id:'admin',password:password()},maker:{id:'p12-maker',password:password()},reviewer:{id:'p12-reviewer',password:password()}};
  const project='p12-t6',setupProject='p12-enterprise-example';
  process.env.ADMIN_PASSWORD=logins.admin.password;
  const store=openStore(data),finance=financeService(store),accounts=accountService(store),access=policy(store),admin=store.get('users','admin');
  const context={actorId:admin.uid,actorUid:admin.uid,actorName:admin.name,requestId:'p12-isolated-setup'};
  let next=0;
  const command=(reason:string,values:Record<string,unknown>)=>({requestKey:'p12-seed-'+next++,reason,...values});
  try {
    for(const [id,title] of [[project,'P12 Synthetic T6 Budget'],[setupProject,'P12 Enterprise Policy Example']]){
      store.put('projects',{id,title,description:'Isolated budget review',owner:'Project Station',category:'Review',progress:0});
      store.saveTasks(id,template(id));
    }
    const makerAccount=accounts.create(admin,{...logins.maker,name:'Budget Preparer',role:'editor'},context)!;
    const reviewerAccount=accounts.create(admin,{...logins.reviewer,name:'Independent Approver',role:'editor'},context)!;
    const approvalGroup=access.saveGroup(admin,undefined,{name:'P12 Budget Approval Only',capabilities:['financeRead','financeApprove']},context);
    access.setMember(admin,project,makerAccount.id,'finance-controller',context);
    access.setMember(admin,project,reviewerAccount.id,approvalGroup.id,context);
    const maker=store.get('users',logins.maker.id),reviewer=store.get('users',logins.reviewer.id);
    const add=(v:{id:string;revision:number},change:unknown,actor:any=maker)=>{
      const common={revision:v.revision,effectivePeriod:p12Range,changeSet:[change]};
      const preview=finance.preview(actor,project,v.id,command('Prepare synthetic ledger posting',common));
      const save=finance.save(actor,project,v.id,command('Save synthetic ledger posting',{...common,candidateSha256:preview.candidateSha256,
        previewCalculationVersion:preview.calculationVersion}),context);
      v.revision=save.revision;
      return preview.fields[0].key as string;
    };
    const base=finance.create(admin,project,command('Create T6 budget version',{snapshot:{...p12Scenario(),name:'T6 Approved Budget'}}),context);
    add(base,t6Policy);
    const scope=add(base,t6Scope),allocation=add(base,t6Allocation(scope));add(base,t6Confirm(allocation),reviewer);
    add(base,t6Forecast(scope,1000));
    const frozen=finance.freeze(admin,project,base.id,command('Freeze approved T6 baseline',{revision:base.revision,stateRevision:0}),context);
    const current=finance.create(admin,project,command('Create T6 forecast',{parentId:base.id,parentRevision:frozen.revision,name:'T6 Current Forecast'}),context);
    const cost=add(current,t6Cost(scope,400,'T6-BASE-COST','T6 Accepted Service'));add(current,t6Confirm(cost),reviewer);
    add(current,t6Forecast(scope));
    const draft=add(current,t6Cost(scope,50,'T6-DRAFT-COST','T6 Follow-up Service'));
    finance.activate(admin,project,current.id,command('Select the T6 forecast',{revision:current.revision,stateRevision:frozen.stateRevision}),context);
    const workflow=finance.create(admin,project,command('Create isolated T6 workflow draft',
      {parentId:current.id,parentRevision:current.revision,name:'T6 Workflow Review'}),context);
    const setup=finance.create(admin,setupProject,command('Create non-T6 enterprise draft',
      {snapshot:{...p12Scenario(),name:'Enterprise Budget Draft'}}),context);
    finance.activate(admin,setupProject,setup.id,command('Select enterprise draft',{revision:setup.revision,stateRevision:0}),context);
    writeFileSync(credentials,JSON.stringify(logins,null,2)+'\n');
    writeFileSync(index,JSON.stringify({data,credentials,directory,project,setupProject,workflow:workflow.id,scope,cost,draft,reviewerUid:reviewerAccount.id},null,2)+'\n');
  } finally {store.db.close();}
  console.log('Local review credentials: '+credentials);
}
process.env.DATA_DIR=data;process.env.PORT=process.env.PORT??'18752';process.env.FINANCE_PROTOTYPE='0';
await import('../server.ts');
