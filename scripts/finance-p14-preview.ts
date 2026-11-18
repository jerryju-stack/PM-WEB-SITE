/** Build a P14-only review database from the authorized P05 snapshot and labeled synthetic cases. */
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {accountService} from '../lib/accounts.ts';
import {openStore} from '../lib/database.ts';
import {Decimal} from '../lib/finance-decimal.ts';
import {developmentCosts} from '../lib/finance-development.ts';
import {financeService} from '../lib/finance.ts';
import type {FinanceSnapshot} from '../lib/finance-contracts.ts';
import {policy} from '../lib/policy.ts';
import {template} from '../lib/schedule.ts';
import {restoreSnapshot} from '../lib/snapshots.ts';
import {laborScenario} from '../tests/fixtures/finance-p06.ts';
import {p08Scenario} from '../tests/fixtures/finance-p08.ts';
import {engineeringCost,p10Scenario,packageCost,prototypeCost,retestCost} from '../tests/fixtures/finance-p10.ts';
import {p11Scenario,capitalRange,capitalChange,t5Asset,t5Agreement} from '../tests/fixtures/finance-p11.ts';
import {p12Scenario,t6Policy,t6Scope,t6Allocation,t6Confirm,t6Cost,t6Forecast} from '../tests/fixtures/finance-p12.ts';

const location=resolve('.deploy/finance-p14'),index=join(location,'latest-run.json');
const port=process.env.PORT??'18754';
let data:string;
if(process.argv.includes('--reuse')||process.argv.includes('--restored')){
  const prior=JSON.parse(readFileSync(index,'utf8'));
  data=process.argv.includes('--restored')?join(prior.directory,'restored'):prior.data;
  if(!existsSync(join(data,'project-station.sqlite')))throw Error('The selected P14 review database has not been built.');
} else {
  const baseline=JSON.parse(readFileSync('.deploy/finance-p05/latest-run.json','utf8'));
  const directory=join(location,'run-'+new Date().toISOString().replace(/[:.]/g,'-'));
  const credentials=join(directory,'local-login.json');
  data=join(directory,'data');
  mkdirSync(directory,{recursive:true});
  restoreSnapshot(baseline.backup,data);
  const store=openStore(data),finance=financeService(store),accounts=accountService(store),access=policy(store),admin=store.get('users','admin');
  const roleNames={admin:'Local Review Administrator',reader:'Finance Reader',businessReader:'Business Project Reader',maker:'Budget Preparer',reviewer:'Independent Approver',
    quality:'Validation Quality',commercial:'Commercial Preparer'};
  const logins=Object.fromEntries(Object.keys(roleNames).map(role=>[role,{id:role==='admin'?'admin':'p14-'+role,password:randomBytes(24).toString('base64url')}]));
  const context=(actor=admin)=>({actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'p14-isolated-setup'});
  let sequence=0;
  const command=(reason:string,values:Record<string,unknown>)=>({requestKey:'p14-seed-'+sequence++,reason,...values});
  type Version={id:string;revision:number;stateRevision:number};
  const addProject=(id:string,title:string)=>{
    store.put('projects',{id,title,description:'P14 isolated rehearsal using synthetic inputs',owner:'Project Station',category:'Review',progress:0});
    store.saveTasks(id,template(id));
  };
  const create=(project:string,name:string,snapshot:FinanceSnapshot)=>finance.create(admin,project,
    command('Create synthetic reference scenario',{snapshot:{...snapshot,name}}),context());
  const fork=(project:string,base:Version,name:string)=>finance.create(admin,project,
    command('Derive independent rehearsal draft',{parentId:base.id,parentRevision:base.revision,name}),context());
  const freeze=(project:string,v:Version)=>finance.freeze(admin,project, v.id,
    command('Freeze rehearsal reference',{revision:v.revision,stateRevision:v.stateRevision}),context());
  const activate=(project:string,v:Version,stateRevision:number)=>finance.activate(admin,project,v.id,
    command('Select rehearsal forecast',{revision:v.revision,stateRevision}),context());
  const save=(project:string,version:Version,changeSet:unknown[],actor=admin,effectivePeriod=capitalRange)=>{
    const input={revision:version.revision,effectivePeriod,changeSet};
    const preview=finance.preview(actor,project,version.id,command('Preview synthetic setup',input));
    const receipt=finance.save(actor,project,version.id,command('Persist synthetic setup',{...input,candidateSha256:preview.candidateSha256,
      previewCalculationVersion:preview.calculationVersion}),context(actor));
    version.revision=receipt.revision;
    return preview.fields[0].key as string;
  };
  try{
    accounts.password(admin,admin.uid,{password:logins.admin.password},context(),true);
    const roles=Object.fromEntries(Object.entries(logins).filter(([role])=>role!=='admin').map(([role,login])=>[role,accounts.create(admin,{
      ...login,role:role.toLowerCase().endsWith('reader')?'viewer':'editor',name:roleNames[role as keyof typeof roleNames]},context())!]));
    const members=(project:string,assignments:Record<string,string>)=>Object.entries(assignments).forEach(([role,group])=>
      access.setMember(admin,project,roles[role].id,group,context()));
    const scenarios={p08:'p14-business',p09:'p14-me',p10:'p14-development',p11:'p14-capital',p12:'p14-budget',enterprise:'p14-enterprise'};
    for(const key of Object.values(scenarios))addProject(key,'P14 · Synthetic '+key.slice(4));
    members(baseline.projectId,{reader:'finance-reader'});
    members(scenarios.p08,{commercial:'finance-commercial',businessReader:'finance-reader'});
    members(scenarios.p10,{quality:'finance-validation'});
    const approval=access.saveGroup(admin,undefined,{name:'P14 Independent Finance Approval',capabilities:['financeRead','financeApprove']},context());
    members(scenarios.p12,{maker:'finance-controller',reviewer:approval.id});

    const imported=finance.get(admin,baseline.projectId,baseline.versionId);
    const archive=fork(baseline.projectId,imported,'SIMULATED · CQA later-stage rehearsal');
    const source=imported.snapshot.sources.find(row=>row.sheet==='AME'&&row.cell==='F35')!;
    const row=imported.snapshot.inputs.find(item=>item.sourceKey===source.key&&item.metricKey==='cqa.operations.cycle_time')!;
    const value=Decimal.from(row.value).mul(Decimal.from('1.1'));
    save(baseline.projectId,archive,[{collection:'inputs',key:row.key,value:{coefficient:BigInt(value.text(8).replace('.','')).toString(),scale:8}}],
      admin,{from:'year-2020',to:'year-2020'});

    const business=freeze(scenarios.p08,create(scenarios.p08,'Synthetic Approved Baseline',p08Scenario()));
    const businessDraft=fork(scenarios.p08,business,'SIMULATED · Current Forecast');
    activate(scenarios.p08,businessDraft,business.stateRevision);
    const me=freeze(scenarios.p09,create(scenarios.p09,'T2 Design Reference',laborScenario()));
    const meDraft=fork(scenarios.p09,me,'T2 Measured Labor Rehearsal');activate(scenarios.p09,meDraft,me.stateRevision);
    const dev=create(scenarios.p10,'T4 Cost Reference',p10Scenario());
    const packageKey=save(scenarios.p10,dev,[packageCost]);
    save(scenarios.p10,dev,[prototypeCost(packageKey),retestCost,engineeringCost]);
    const devFrozen=freeze(scenarios.p10,dev),devDraft=fork(scenarios.p10,devFrozen,'T4 Combined Cost Forecast');
    activate(scenarios.p10,devDraft,devFrozen.stateRevision);
    const execution=fork(scenarios.p10,devFrozen,'T4 Execution Rehearsal');
    const rows=developmentCosts(finance.get(admin,scenarios.p10,execution.id).snapshot);
    save(scenarios.p10,execution,[['T4-SAMPLE-BATCH','10'],['T4-RETEST','1']].map(([ref,quantity])=>({
      collection:'development',action:'quantity',key:rows.find(item=>item.conversion.cost.costRef===ref)!.key,quantity})));

    const capital=create(scenarios.p11,'T5 Capital Reference',p11Scenario());
    const asset=save(scenarios.p11,capital,[capitalChange(t5Asset)]);
    save(scenarios.p11,capital,[capitalChange(t5Agreement(asset))]);
    const capitalFrozen=freeze(scenarios.p11,capital),capitalDraft=fork(scenarios.p11,capitalFrozen,'T5 Delayed Recovery Rehearsal');
    activate(scenarios.p11,capitalDraft,capitalFrozen.stateRevision);
    const amount=fork(scenarios.p11,capitalFrozen,'T5 Independent Asset Amount');
    const termsInput=p10Scenario();termsInput.events=[];
    for(const row of termsInput.inputs.filter(row=>row.metricKey==='cash_adjustment'))row.value={...row.value,coefficient:'0'};
    const terms=create(scenarios.p11,'T5 Operating Terms Rehearsal',termsInput);

    const ledger=create(scenarios.p12,'T6 Approved Budget',p12Scenario()),maker=store.get('users',logins.maker.id),reviewer=store.get('users',logins.reviewer.id);
    const posting=(version:Version,change:unknown,actor=maker)=>save(scenarios.p12,version,[change],actor);
    posting(ledger,t6Policy);const scope=posting(ledger,t6Scope);
    posting(ledger,t6Confirm(posting(ledger,t6Allocation(scope))),reviewer);
    posting(ledger,t6Forecast(scope,1000));
    const ledgerFrozen=freeze(scenarios.p12,ledger),ledgerDraft=fork(scenarios.p12,ledgerFrozen,'T6 Current Forecast');
    posting(ledgerDraft,t6Confirm(posting(ledgerDraft,t6Cost(scope,400,'T6-BASE-COST','T6 Accepted Service'))),reviewer);
    posting(ledgerDraft,t6Forecast(scope));
    const draft=posting(ledgerDraft,t6Cost(scope,50,'T6-DRAFT-COST','T6 Follow-up Service'));
    activate(scenarios.p12,ledgerDraft,ledgerFrozen.stateRevision);
    const workflow=fork(scenarios.p12,ledgerDraft,'T6 Workflow Review');
    activate(scenarios.enterprise,create(scenarios.enterprise,'Enterprise Budget Draft',p12Scenario()),0);
    const shared={credentials,directory,projectId:baseline.projectId,baselineId:baseline.versionId,archiveDraft:archive.id};
    const cases={
      p08:{...shared,synthetic:scenarios.p08},p09:{...shared,synthetic:scenarios.p09},
      p10:{...shared,synthetic:scenarios.p10,executionDraft:execution.id},
      p11:{...shared,synthetic:scenarios.p11,amountDraft:amount.id,termsDraft:terms.id},
      p12:{...shared,project:scenarios.p12,setupProject:scenarios.enterprise,workflow:workflow.id,scope,draft,reviewerUid:roles.reviewer.id},
      p13:{...shared,synthetic:scenarios.p08}
    };
    writeFileSync(credentials,JSON.stringify(logins,null,2)+'\n');
    writeFileSync(index,JSON.stringify({...shared,data,cases,scenarios,port,commercialUid:roles.commercial.id,businessDraft:businessDraft.id},null,2)+'\n');
  }finally{store.db.close();}
  console.log('Local review credentials: '+credentials);
}
process.env.DATA_DIR=data;
process.env.PORT=port;
process.env.FINANCE_PROTOTYPE='0';
await import('../server.ts');
