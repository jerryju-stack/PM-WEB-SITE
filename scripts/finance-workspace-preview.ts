/** Starts the normal site on loopback with a disposable restore of the P05 archive. */
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {accountService} from '../lib/accounts.ts';
import {openStore} from '../lib/database.ts';
import {financeService} from '../lib/finance.ts';
import {policy} from '../lib/policy.ts';
import {Decimal} from '../lib/finance-decimal.ts';
import {template} from '../lib/schedule.ts';
import {restoreSnapshot} from '../lib/snapshots.ts';
import {laborScenario,laborChange} from '../tests/fixtures/finance-p06.ts';
import {p08Scenario} from '../tests/fixtures/finance-p08.ts';
import {engineeringCost,p10Scenario,packageCost,prototypeCost,retestCost} from '../tests/fixtures/finance-p10.ts';
import {developmentCosts} from '../lib/finance-development.ts';
import {p11Scenario,capitalRange,capitalChange,t5Asset,t5Agreement} from '../tests/fixtures/finance-p11.ts';

const compare=process.argv.includes('--p13'),capital=process.argv.includes('--p11'),development=process.argv.includes('--p10'),manufacturing=process.argv.includes('--p09'),business=compare||process.argv.includes('--p08'),
  step=compare?'p13':capital?'p11':development?'p10':manufacturing?'p09':business?'p08':'p07';
const root=resolve('.deploy/finance-'+step),index=join(root,'latest-run.json');
const port=process.env.PORT??(compare?'18753':capital?'18751':development?'18750':manufacturing?'18749':business?'18748':'18747');
let data:string;
if(process.argv.includes('--reuse')) {
  data=JSON.parse(readFileSync(index,'utf8')).data;
} else {
  const baseline=JSON.parse(readFileSync('.deploy/finance-p05/latest-run.json','utf8'));
  const directory=join(root,'run-'+new Date().toISOString().replace(/[:.]/g,'-'));
  const credentials=join(directory,'local-login.json');
  data=join(directory,'data');
  mkdirSync(directory,{recursive:true});restoreSnapshot(baseline.backup,data);
  const store=openStore(data),finance=financeService(store),accounts=accountService(store),admin=store.get('users','admin');
  const authorization={actorId:admin.uid,actorUid:admin.uid,actorName:admin.name,requestId:step.toUpperCase()+' isolated review setup'};
  const password=()=>randomBytes(24).toString('base64url');
  const logins={
    admin:{id:'admin',password:password()},reader:{id:step+'reader',password:password()},outside:{id:step+'outside',password:password()},
    ...(development?{quality:{id:'p10quality',password:password()}}:{})
  };
  const synthetic=step+'-synthetic',empty=step+'-empty';
  try {
    accounts.password(admin,admin.uid,{password:logins.admin.password},authorization,true);
    for(const [id,title] of [[synthetic,step.toUpperCase()+' Synthetic Finance Example'],[empty,step.toUpperCase()+' Empty Finance Project']]) {
      store.put('projects',{id,title,description:'Local finance review',owner:'Project Station',category:'Review',progress:0});
      store.saveTasks(id,template(id));
    }
    const reader=accounts.create(admin,{...logins.reader,role:'viewer',name:'Finance Reader'},authorization)!;
    accounts.create(admin,{...logins.outside,role:'viewer',name:'Outside Finance'},authorization);
    policy(store).setMember(admin,baseline.projectId,reader.id,'finance-reader',authorization);
    if(logins.quality){
      const quality=accounts.create(admin,{...logins.quality,role:'editor',name:'Validation Quality'},authorization)!;
      policy(store).setMember(admin,synthetic,quality.id,'finance-validation',authorization);
    }
    const imported=finance.get(admin,baseline.projectId,baseline.versionId);
    const archiveDraft=finance.create(admin,baseline.projectId,{requestKey:'archive-review-draft',reason:'Isolated review draft',parentId:imported.id,parentRevision:imported.revision,name:compare?'SIMULATED · CQA later-stage rehearsal':'CQA Review Draft'},authorization);
    if(compare){
      const source=imported.snapshot.sources.find(row=>row.sheet==='AME'&&row.cell==='F35')!;
      const input=imported.snapshot.inputs.find(row=>row.sourceKey===source.key&&row.metricKey==='cqa.operations.cycle_time')!;
      const value=Decimal.from(input.value).mul(Decimal.from('1.1'));
      const candidate={revision:archiveDraft.revision,reason:'Simulated shared AME CT +10%',effectivePeriod:{from:'year-2020',to:'year-2020'},
        changeSet:[{collection:'inputs',key:input.key,value:{coefficient:BigInt(value.text(8).replace('.','')).toString(),scale:8}}]};
      const preview=finance.preview(admin,baseline.projectId,archiveDraft.id,{...candidate,requestKey:'p13-archive-preview'});
      finance.save(admin,baseline.projectId,archiveDraft.id,{...candidate,requestKey:'p13-archive-save',previewCalculationVersion:preview.calculationVersion,
        candidateSha256:preview.candidateSha256},authorization);
    }
    const sample=capital?p11Scenario():development?p10Scenario():business?p08Scenario():laborScenario();
    sample.name='Synthetic Approved Baseline';
    const approved=finance.create(admin,synthetic,{requestKey:'p07-synthetic-baseline',reason:'Synthetic review baseline',snapshot:sample},authorization);
    let approvedRevision=approved.revision;
    const seed=(changeSet:Record<string,unknown>[])=>{
      const payload={revision:approvedRevision,effectivePeriod:capitalRange,changeSet,reason:'Synthetic finance fixture'};
      const prepared=finance.preview(admin,synthetic,approved.id,{...payload,requestKey:step+'-seed-preview-'+approvedRevision});
      const saved=finance.save(admin,synthetic,approved.id,{...payload,requestKey:step+'-seed-save-'+approvedRevision,candidateSha256:prepared.candidateSha256,
        previewCalculationVersion:prepared.calculationVersion},authorization);
      approvedRevision=saved.revision;
      return prepared.fields[0].key;
    };
    if(development){
      const pkg=seed([packageCost]);
      seed([prototypeCost(pkg),retestCost,engineeringCost]);
    }
    if(capital){
      const asset=seed([capitalChange(t5Asset)]);
      seed([capitalChange(t5Agreement(asset))]);
    }
    const frozen=finance.freeze(admin,synthetic,approved.id,{requestKey:'p07-synthetic-freeze',reason:'Synthetic review baseline',revision:approvedRevision,stateRevision:0},authorization);
    const draft=finance.create(admin,synthetic,{requestKey:'p07-synthetic-draft',reason:'Synthetic review forecast',name:compare?'SIMULATED · Current Forecast':'Synthetic Current Forecast',parentId:approved.id,parentRevision:frozen.revision},authorization);
    const amountDraft=capital?finance.create(admin,synthetic,{requestKey:'p11-amount-draft',reason:'Independent investment amount review',
      name:'T5 Investment Amount Review',parentId:approved.id,parentRevision:frozen.revision},authorization).id:null;
    let termsDraft:string|null=null;
    if(capital){
      const operating=p10Scenario();
      operating.name='P11 Working Capital Review';operating.events=[];
      for(const row of operating.inputs.filter(input=>input.metricKey==='cash_adjustment'))row.value={...row.value,coefficient:'0'};
      termsDraft=finance.create(admin,synthetic,{requestKey:'p11-terms-draft',reason:'Independent working-capital review',snapshot:operating},authorization).id;
    }
    let executionDraft:string|null=null;
    if(development){
      const execution=finance.create(admin,synthetic,{requestKey:'p10-execution-draft',reason:'Separate actual timing review',name:'Validation Execution Review',
        parentId:approved.id,parentRevision:frozen.revision},authorization);
      executionDraft=execution.id;
      const rows=developmentCosts(finance.get(admin,synthetic,execution.id).snapshot);
      const changeSet=[['T4-SAMPLE-BATCH','10'],['T4-RETEST','1']].map(([ref,quantity])=>({
        collection:'development',action:'quantity',key:rows.find(row=>row.conversion.cost.costRef===ref)!.key,quantity
      }));
      const body={revision:execution.revision,reason:'Synthetic combined forecast for actual timing',changeSet,effectivePeriod:{from:'year-1',to:'year-1'}};
      const preview=finance.preview(admin,synthetic,execution.id,{...body,requestKey:'p10-execution-preview'});
      finance.save(admin,synthetic,execution.id,{...body,requestKey:'p10-execution-save',candidateSha256:preview.candidateSha256,
        previewCalculationVersion:preview.calculationVersion},authorization);
    }
    let revision=draft.revision;
    if(!business&&!manufacturing&&!development&&!capital){
      const candidate=finance.preview(admin,synthetic,draft.id,laborChange);
      const {effectivePeriod,changeSet}=laborChange;
      const saved=finance.save(admin,synthetic,draft.id,{revision,effectivePeriod,changeSet,requestKey:'p07-synthetic-save',reason:'Synthetic forecast candidate',candidateSha256:candidate.candidateSha256,previewCalculationVersion:candidate.calculationVersion},authorization);
      revision=saved.revision;
    }
    finance.activate(admin,synthetic,draft.id,{requestKey:step+'-synthetic-activate',reason:'Synthetic review forecast',revision,stateRevision:frozen.stateRevision},authorization);
    writeFileSync(index,JSON.stringify({data,credentials,directory,projectId:baseline.projectId,baselineId:baseline.versionId,archiveDraft:archiveDraft.id,synthetic,empty,
      ...(executionDraft?{executionDraft}:{}),...(amountDraft?{amountDraft}:{}),...(termsDraft?{termsDraft}:{})},null,2)+'\n');
  } finally {store.db.close();}
  writeFileSync(credentials,JSON.stringify(logins,null,2)+'\n');
  console.log('Local review credentials: '+credentials);
}
process.env.DATA_DIR=data;process.env.FINANCE_PROTOTYPE='0';process.env.PORT=port;
await import('../server.ts');
