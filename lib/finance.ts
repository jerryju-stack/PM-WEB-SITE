import type {DatabaseSync} from "node:sqlite";
import {createHash,randomUUID} from 'node:crypto';
import type {Store} from './database.ts';
import {accountByUid} from './accounts.ts';
import {policy} from './policy.ts';
import type {Capability} from './policy.ts';
import {audit} from './audit.ts';
import type {WriteContext} from './audit.ts';
import {invalid} from './contracts.ts';
import {financeEditCapabilities} from './finance-schema.ts';
import {financeSnapshot,financeCommand,financeRevision,financeKey} from './finance-contracts.ts';
import type {FinanceSnapshot,FinanceModule,FinanceProjectState,FinanceVersionSummary,FinanceWriteResult} from './finance-contracts.ts';
import {calculateFinance,compareCalculations,financeCalculationVersion} from './finance-calculation.ts';
import {applyFinanceChanges,previewImpact,replacedFinanceDriver,supportsFinanceDriver} from './finance-preview.ts';
import {workspaceComparison,workspaceReport} from './finance-workspace.ts';
import {archived,businessFields,businessFx,businessInputs,hasBusinessModel,isBusiness,isBusinessSource} from './finance-business.ts';
import {commercialWorkspace,factoryCostWorkspace,materialCostSchedule} from './finance-commercial-workspace.ts';
import {Decimal} from './finance-decimal.ts';
import {isOperationsInput,isOperationsSource} from './finance-operations.ts';
import {operationsWorkspace} from './finance-operations-calculation.ts';
import {isDevelopmentInput,isDevelopmentModule,isDevelopmentSource,supportsDevelopment} from './finance-development.ts';
import {developmentWorkspace} from './finance-development-calculation.ts';
import {capitalAssets,isCapitalInput,isCapitalSource,supportsCapital} from './finance-capital.ts';
import {capitalWorkspace} from './finance-capital-workspace.ts';
import {budgetAction,isBudgetEvent,isBudgetInput,isBudgetSource} from './finance-budget.ts';
import {budgetWorkspace} from './finance-budget-calculation.ts';
import {FinanceBridgeInputs} from './finance-bridge-inputs.ts';
import {financeBridges} from './finance-bridges.ts';
import {comparisonSources,financeSourceIndex} from './finance-comparison-sources.ts';
import {financeCurrencyScales} from './finance-fx.ts';
import {compareFinanceFx,displayFinance,financeFxBasis,financeFxModes} from './finance-fx-report.ts';
import type {FinanceFxMode} from './finance-fx-report.ts';

export function canonicalFinance(value:any):string {
  if(Array.isArray(value))return '['+value.map(canonicalFinance).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalFinance(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const financeDigest=(v:any)=>createHash('sha256').update(canonicalFinance(v)).digest('hex');
const dimensions=['products','markets','lines','periods'] as const;
const parse=(v:any)=>JSON.parse(String(v));
const noAccess=()=>invalid('Finance project unavailable',404);
export function readFinanceSnapshot(db:DatabaseSync,projectId:string,id:string):FinanceSnapshot {
    const v=db.prepare('SELECT * FROM finance_versions WHERE project_id=? AND id=?').get(projectId,id) as any; if(!v)noAccess(); const rows=(table:string):any[]=>db.prepare('SELECT * FROM finance_'+table+' WHERE project_id=? AND version_id=? ORDER BY stable_key').all(projectId,id);
    const scope=(r:any)=>({key:r.stable_key,module:r.module,productKey:r.product_key,marketKey:r.market_key,lineKey:r.line_key,periodKey:r.period_key,sourceKey:r.source_key});
    return financeSnapshot({
      name:v.name,currency:v.currency,currencyScale:Number(v.currency_scale),basis:v.basis,asOf:v.as_of,dictionaryVersion:v.dictionary_version,
      calculationVersion:v.calculation_version,policy:parse(v.policy_json),
      ...Object.fromEntries(dimensions.map(k=>[k,rows(k).map(r=>({key:r.stable_key,label:r.label,metadata:parse(r.metadata_json)}))])),
      sources:rows('sources').map(r=>({key:r.stable_key,system:r.system,externalKey:r.external_key,fingerprint:r.fingerprint,sheet:r.sheet,cell:r.cell,
        owner:r.owner,observation:r.observation,mappingStatus:r.mapping_status,originalCurrency:r.original_currency,originalUnit:r.original_unit,
        originalPeriod:r.original_period,effectiveFrom:r.effective_from,effectiveTo:r.effective_to,metadata:parse(r.metadata_json)})),
      inputs:rows('inputs').map(r=>({...scope(r),metricKey:r.metric_key,valueKind:r.value_kind,value:{coefficient:r.coefficient,scale:Number(r.scale)},
        unit:r.unit,currency:r.currency,effectiveFrom:r.effective_from,effectiveTo:r.effective_to,conversion:parse(r.conversion_json)})),
      events:rows('events').map(r=>({...scope(r),kind:r.kind,amount:{coefficient:r.coefficient,scale:Number(r.scale)},currency:r.currency,
        eventDate:r.event_date,relatedKey:r.related_key,evidenceKey:r.evidence_key}))
    },50000);
  }

export function financeService(store:Store) {
  const db=store.db,access=policy(store);
  function authorize(user:any,projectId:string,cap:Capability='financeRead') {
    const live=user&&accountByUid(store,user.uid);
    if(!live)invalid('Please sign in',401);
    if(!access.can(live,'financeRead',projectId)||!store.get('projects',projectId))noAccess();
    if(!access.can(live,cap,projectId))invalid('Finance capability required: '+cap,403);
    return live;
  }
  function version(projectId:string,id:string):any {
    const row=db.prepare('SELECT * FROM finance_versions WHERE project_id=? AND id=?').get(projectId,id);
    if(!row)noAccess();return row;
  }
  function state(projectId:string):FinanceProjectState {
    const row=db.prepare('SELECT * FROM finance_project_state WHERE project_id=?').get(projectId);
    return {approvedBaselineId:row?.approved_baseline_id?String(row.approved_baseline_id):null,currentVersionId:row?.current_version_id?String(row.current_version_id):null,stateRevision:Number(row?.revision??0)};
  }
  function summary(row:any):FinanceVersionSummary {
    return {id:row.id,projectId:row.project_id,parentId:row.parent_id,name:row.name,status:row.status,revision:Number(row.revision),
      currency:row.currency,currencyScale:Number(row.currency_scale),basis:row.basis,asOf:row.as_of,
      dictionaryVersion:row.dictionary_version,calculationVersion:row.calculation_version,createdUid:row.created_uid,
      model:parse(row.policy_json)?.rules?.model,
      updatedUid:row.updated_uid,approvedUid:row.approved_uid,createdAt:row.created_at,updatedAt:row.updated_at,approvedAt:row.approved_at};
  }
  const snapshot=(p:string,id:string)=>readFinanceSnapshot(db,p,id);
  function get(user:any,p:string,id:string) {authorize(user,p);return {...summary(version(p,id)),snapshot:snapshot(p,id),...state(p)};}
  function project(user:any,p:string) {
    authorize(user,p);
    const versions=db.prepare('SELECT * FROM finance_versions WHERE project_id=? ORDER BY created_at,id').all(p).map(summary);
    return {projectId:p,state:versions.length?'ready':'empty',versions,...state(p)};
  }
  function projects(user:any) {
    const live=user&&accountByUid(store,user.uid);if(!live)invalid('Please sign in',401);
    return {projects:store.all('projects').filter(p=>access.can(live,'financeRead',p.id)).map(p=>({id:p.id,title:p.title,...state(p.id)}))};
  }
  function insert(table:string,values:Record<string,any>) {
    const keys=Object.keys(values);db.prepare('INSERT INTO finance_'+table+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(values));
  }
  function replaceContent(p:string,id:string,s:FinanceSnapshot) {
    // Delete dependants first; the deferred event self-reference permits a complete atomic replacement.
    for(const table of ['events','inputs','sources',...dimensions])db.prepare('DELETE FROM finance_'+table+' WHERE project_id=? AND version_id=?').run(p,id);
    const base={project_id:p,version_id:id};
    for(const table of dimensions)for(const r of s[table])insert(table,{...base,stable_key:r.key,label:r.label,metadata_json:canonicalFinance(r.metadata)});
    for(const r of s.sources)insert('sources',{...base,stable_key:r.key,system:r.system,external_key:r.externalKey,fingerprint:r.fingerprint,sheet:r.sheet,cell:r.cell,
      owner:r.owner,observation:r.observation,mapping_status:r.mappingStatus,original_currency:r.originalCurrency,original_unit:r.originalUnit,
      original_period:r.originalPeriod,effective_from:r.effectiveFrom,effective_to:r.effectiveTo,metadata_json:canonicalFinance(r.metadata)});
    const scoped=(r:any)=>({...base,stable_key:r.key,module:r.module,product_key:r.productKey,market_key:r.marketKey,line_key:r.lineKey,period_key:r.periodKey,source_key:r.sourceKey});
    for(const r of s.inputs)insert('inputs',{...scoped(r),metric_key:r.metricKey,value_kind:r.valueKind,coefficient:r.value.coefficient,scale:r.value.scale,
      unit:r.unit,currency:r.currency,effective_from:r.effectiveFrom,effective_to:r.effectiveTo,conversion_json:canonicalFinance(r.conversion)});
    for(const r of s.events)insert('events',{...scoped(r),kind:r.kind,coefficient:r.amount.coefficient,scale:r.amount.scale,currency:r.currency,
      event_date:r.eventDate,related_key:r.relatedKey,evidence_key:r.evidenceKey});
  }
  function delta(before:FinanceSnapshot|null,after:FinanceSnapshot) {
    const rows:{collection:'inputs'|'events';key:string;before:any;after:any}[]=[];
    for(const collection of ['inputs','events'] as const) {
      const a=new Map<string,any>((before?.[collection]??[]).map(r=>[r.key,r] as [string,any])),b=new Map<string,any>(after[collection].map(r=>[r.key,r] as [string,any]));
      for(const key of new Set([...a.keys(),...b.keys()]))if(canonicalFinance(a.get(key)??null)!==canonicalFinance(b.get(key)??null))rows.push({collection,key,before:a.get(key)??null,after:b.get(key)??null});
    }
    return rows;
  }
  function changedRights(live:any,p:string,before:FinanceSnapshot|null,after:FinanceSnapshot,systemCalculationVersion=false) {
    const changes=delta(before,after),modules=new Set<FinanceModule>();
    for(const r of changes)for(const item of [r.before,r.after])if(item)modules.add(item.module);
    for(const module of modules)authorize(live,p,financeEditCapabilities[module]);
    if(changes.some(change=>[change.before,change.after].some(row=>row?.metricKey==='p09.rate')))authorize(live,p,'financeApprove');
    const head=(s:FinanceSnapshot|null)=>s?Object.fromEntries(Object.entries(s).filter(([k])=>!['inputs','events',...(systemCalculationVersion?['calculationVersion']:[])].includes(k))
      .map(([key,value])=>[key,key==='sources'&&systemCalculationVersion?s.sources.filter(source=>
        !isBusinessSource(source)&&!isOperationsSource(source)&&!isDevelopmentSource(source)&&!isCapitalSource(source)&&!isBudgetSource(source)):value])):null;
    if(canonicalFinance(head(before))!==canonicalFinance(head(after)))authorize(live,p,'financeVersionEdit');
    return changes;
  }
  function protectStructuredInputs(before:FinanceSnapshot|null,after:FinanceSnapshot) {
    const protectedRows=(s:FinanceSnapshot|null)=>[s?.inputs.filter(row=>isOperationsInput(row)||isDevelopmentInput(row)||isCapitalInput(row)||isBudgetInput(row))??[],
      s?.sources.filter(row=>isOperationsSource(row)||isDevelopmentSource(row)||isCapitalSource(row)||isBudgetSource(row))??[],
      s?.events.filter(isBudgetEvent)??[]];
    if(financeDigest(protectedRows(before))!==financeDigest(protectedRows(after)))invalid('Use revision-bound business source changes to write these records.');
  }
  function authorizeOperationsCommand(live:any,p:string,raw:unknown) {
    if(!Array.isArray(raw)||raw[0]?.collection!=='operations')return;
    authorize(live,p,'financeOperationsEdit');
    if(raw[0].record?.type==='rate')authorize(live,p,'financeApprove');
  }
  function authorizeBudgetCommand(live:any,p:string,action:ReturnType<typeof budgetAction>){
    if(!action)return;
    authorize(live,p,action==='confirm'?'financeApprove':'financeBudgetEdit');
    if(action==='policy')authorize(live,p,'financeVersionEdit');
  }
  function blockedCalculation(before:ReturnType<typeof calculateFinance>,after:ReturnType<typeof calculateFinance>,candidate:FinanceSnapshot) {
    return after.issues.find(issue=>issue.code==='missing_fx'&&issue.outputId.endsWith(':fx')&&before.outputs[issue.outputId]?.status!=='missing_fx')??
      after.issues.find(issue=>[':route_labor',':earned_recovery',':capital_basis',':piece-earned'].some(suffix=>issue.outputId.endsWith(suffix)))??
      (hasBusinessModel(candidate)?newBusinessErrors(before,after)[0]:undefined);
  }
  function revision(v:any,expected:any) {
    if(v.revision!==financeRevision(expected))invalid('Finance revision conflict; reload before retrying',409);
  }
  function evidence(live:any,p:string,id:string,op:string,body:any,before:any,after:any,revBefore:number|null,revAfter:number,context:WriteContext):FinanceWriteResult {
    const changeSetId=randomUUID(),hash=financeDigest(after),now=new Date().toISOString();
    insert('changes',{id:changeSetId,project_id:p,version_id:id,operation:op,revision_before:revBefore,revision_after:revAfter,actor_uid:live.uid,
      reason:body.reason,occurred_at:now,before_sha256:before?financeDigest(before):null,after_sha256:hash,payload_json:canonicalFinance({before,after})});
    // Actor identity is derived from the live account; callers cannot forge audit attribution.
    audit(db,{...context,actorId:live.uid,actorUid:live.uid,actorName:live.name},'finance',id,
      before?{id,revision:revBefore,snapshotSha256:financeDigest(before)}:null,
      {id,projectId:p,revision:revAfter,snapshotSha256:hash,changeSetId,status:version(p,id).status},{projectId:p,revisionBefore:revBefore,revisionAfter:revAfter});
    return {ok:true,id,projectId:p,revision:revAfter,status:version(p,id).status,changeSetId,snapshotSha256:hash,...state(p)};
  }
  function receipt(live:any,p:string,op:string,body:any,run:()=>any) {
    if(op.startsWith('save')&&budgetAction(body.changeSet)!=='confirm'&&
      !['financeVersionEdit',...Object.values(financeEditCapabilities)].some(cap=>access.can(live,cap as Capability,p)))invalid('Finance edit capability required',403);
    const requestHash=financeDigest({operation:op,body});
    const row=db.prepare('SELECT * FROM finance_receipts WHERE project_id=? AND actor_uid=? AND request_key=?').get(p,live.uid,body.requestKey);
    if(row) {
      if(row.operation!==op||row.request_sha256!==requestHash)invalid('Idempotency key reused with a different request',409);
      // Recheck duties from committed evidence even when the version has since changed.
      const result=parse(row.result_json),change=db.prepare('SELECT payload_json FROM finance_changes WHERE id=? AND project_id=?').get(result.changeSetId,p);
      if(op.startsWith('create')||op.startsWith('save')||op.startsWith('cqa_import')){const payload=parse(change!.payload_json);changedRights(live,p,payload.before?.snapshot??null,payload.after.snapshot,op.startsWith('save')&&body.changeSet!==undefined);}
      return result;
    }
    const result=run();
    insert('receipts',{project_id:p,actor_uid:live.uid,request_key:body.requestKey,operation:op,request_sha256:requestHash,result_json:canonicalFinance(result),created_at:new Date().toISOString()});
    return result;
  }
  function create(user:any,p:string,raw:unknown,context:WriteContext) {
    return store.transaction(()=>{
      const live=authorize(user,p,'financeVersionEdit'),body=financeCommand(raw,['snapshot','parentId','parentRevision','name']);
      return receipt(live,p,'create',body,()=>{
        let parent:FinanceSnapshot|undefined;
        if(body.parentId!==undefined&&body.parentId!==null) {financeKey(body.parentId);const v=version(p,body.parentId);revision(v,body.parentRevision);parent=snapshot(p,body.parentId);}
        else if(body.parentRevision!==undefined)invalid('Parent revision requires a parent',400);
        if(body.name!==undefined&&body.snapshot!==undefined)invalid('A name override is only valid when cloning a stored parent.');
        let s=body.snapshot===undefined&&parent?financeSnapshot({...parent,name:body.name??parent.name+' draft'},50000):financeSnapshot(body.snapshot);
        if(parent?.policy.fx&&!s.policy.fx&&!archived(s))s=financeSnapshot({...s,policy:{...s.policy,
          currencyScales:{...parent.policy.currencyScales,...s.policy.currencyScales},fx:parent.policy.fx}});
        if(s.policy.fx)s.calculationVersion=financeCalculationVersion(s);
        if(body.snapshot!==undefined)protectStructuredInputs(null,s);
        changedRights(live,p,null,s);
        const id=randomUUID(),now=new Date().toISOString();
        insert('versions',{id,project_id:p,parent_id:body.parentId??null,name:s.name,status:'draft',revision:0,currency:s.currency,currency_scale:s.currencyScale,
          basis:s.basis,as_of:s.asOf,dictionary_version:s.dictionaryVersion,calculation_version:s.calculationVersion,policy_json:canonicalFinance(s.policy),
          created_uid:live.uid,updated_uid:live.uid,approved_uid:null,created_at:now,updated_at:now,approved_at:null});
        replaceContent(p,id,s);
        return evidence(live,p,id,'create',body,null,{snapshot:s,status:'draft'},null,0,context);
      });
    });
  }
  function save(user:any,p:string,id:string,raw:unknown,context:WriteContext) {
    return store.transaction(()=>{
      const live=authorize(user,p),body=financeCommand(raw,['snapshot','revision','changeSet','effectivePeriod','candidateSha256','previewCalculationVersion','fxSettings']);
      if(body.fxSettings!==undefined)authorize(live,p,'financeVersionEdit');
      authorizeOperationsCommand(live,p,body.changeSet);
      const action=budgetAction(body.changeSet);
      authorizeBudgetCommand(live,p,action);
      return receipt(live,p,'save:'+id,body,()=>{
        const v=version(p,id);revision(v,body.revision);if(v.status!=='draft')invalid('Frozen versions require a new draft',409);
        const before=snapshot(p,id);
        if(body.fxSettings!==undefined){
          if(body.snapshot!==undefined||body.changeSet!==undefined)invalid('Save FX settings as a separate revision.');
          const {candidate,calculation}=fxCandidate(before,body.fxSettings);
          if(body.candidateSha256!==financeDigest(candidate))invalid('Preview this revision of the FX settings before saving.',409);
          const missing=calculation.issues.find(issue=>issue.code==='missing_fx'&&issue.outputId.endsWith(':fx'));
          if(missing)invalid('Finance FX: '+missing.message);
          db.prepare('UPDATE finance_versions SET currency=?,currency_scale=?,policy_json=?,calculation_version=?,revision=revision+1,updated_uid=?,updated_at=? WHERE project_id=? AND id=?')
            .run(candidate.currency,candidate.currencyScale,canonicalFinance(candidate.policy),candidate.calculationVersion,live.uid,new Date().toISOString(),p,id);
          return evidence(live,p,id,'save_fx',body,{snapshot:before,status:'draft'},{snapshot:candidate,status:'draft'},v.revision,v.revision+1,context);
        }
        if(body.snapshot!==undefined&&body.changeSet!==undefined)invalid('Choose either a snapshot or a compact changeSet.');
        const s=body.changeSet===undefined?financeSnapshot(body.snapshot):applyFinanceChanges(before,body.changeSet,body.effectivePeriod,live.uid).candidate;
        if(s.policy.fx)s.calculationVersion=financeCalculationVersion(s);
        if(body.changeSet===undefined)protectStructuredInputs(before,s);
        changedRights(live,p,before,s,body.changeSet!==undefined);
        let calculationSha256:string|undefined;
        if(body.changeSet!==undefined) {
          s.calculationVersion=financeCalculationVersion(s);
          if(body.previewCalculationVersion!==s.calculationVersion||body.candidateSha256!==financeDigest(s))invalid('Finance preview no longer matches this candidate or calculation version; preview again.',409);
          const calculation=calculateFinance(s);
          const problem=action?null:blockedCalculation(calculateFinance(before),calculation,s);
          if(problem)invalid('The candidate makes a calculation incomplete: '+problem.message);
          calculationSha256=financeDigest(calculation);
        }
        replaceContent(p,id,s);
        db.prepare('UPDATE finance_versions SET name=?,currency=?,currency_scale=?,basis=?,as_of=?,dictionary_version=?,calculation_version=?,policy_json=?,revision=revision+1,updated_uid=?,updated_at=? WHERE project_id=? AND id=?')
          .run(s.name,s.currency,s.currencyScale,s.basis,s.asOf,s.dictionaryVersion,s.calculationVersion,canonicalFinance(s.policy),live.uid,new Date().toISOString(),p,id);
        const result=evidence(live,p,id,'save',body,{snapshot:before,status:'draft'},{snapshot:s,status:'draft'},v.revision,v.revision+1,context);
        return calculationSha256?{...result,calculationSha256,calculationVersion:s.calculationVersion}:result;
      });
    });
  }
  function fxCandidate(before:FinanceSnapshot,value:unknown){
    if(archived(before))invalid('CQA workbook versions retain the approved workbook FX basis.');
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='currency,snapshot')
      return invalid('Finance FX: provide a Case currency and snapshot.');
    const settings=value as {currency:string;snapshot:unknown};
    const currencyScales={...financeCurrencyScales,...before.policy.currencyScales};
    const candidate=financeSnapshot({...before,currency:settings.currency,currencyScale:currencyScales[settings.currency],
      policy:{...before.policy,currencyScales,fx:settings.snapshot}},50000);
    if(!candidate.policy.fx)invalid('Finance FX: snapshot required.');
    candidate.calculationVersion=financeCalculationVersion(candidate);
    return {candidate,calculation:calculateFinance(candidate)};
  }
  function previewFx(user:any,p:string,id:string,raw:unknown){
    return store.transaction(()=>{
      authorize(user,p,'financeVersionEdit');
      const body=financeCommand(raw,['revision','fxSettings']),v=version(p,id);
      revision(v,body.revision);if(v.status!=='draft')invalid('Frozen versions require a new draft',409);
      const before=snapshot(p,id),{candidate,calculation}=fxCandidate(before,body.fxSettings);
      const original=calculateFinance(before),keys=['revenue','total_cost','operating_profit','operating_margin','npv','peak_funding_requirement'];
      const pick=(report:typeof original)=>Object.fromEntries(keys.filter(key=>report.metrics[key]).map(key=>[key,report.metrics[key]]));
      return {revision:v.revision,candidateSha256:financeDigest(candidate),before:pick(original),after:pick(calculation),
        missingFx:[...new Set(calculation.issues.filter(issue=>issue.code==='missing_fx'&&issue.outputId.endsWith(':fx')).map(issue=>issue.message))]};
    });
  }
  function preview(user:any,p:string,id:string,raw:unknown) {
    return store.transaction(()=>{
      const live=authorize(user,p),body=financeCommand(raw,['snapshot','revision','changeSet','effectivePeriod','clientSequence']);
      const action=budgetAction(body.changeSet);
      authorize(live,p,action==='confirm'?'financeApprove':'financePreview');
      authorizeBudgetCommand(live,p,action);
      const v=version(p,id);
      authorizeOperationsCommand(live,p,body.changeSet);
      revision(v,body.revision);const before=snapshot(p,id);
      if(body.snapshot!==undefined&&body.changeSet!==undefined)invalid('Choose either a snapshot or a compact changeSet.');
      if(body.clientSequence!==undefined&&(!Number.isSafeInteger(body.clientSequence)||body.clientSequence<0))invalid('Invalid preview clientSequence.');
      const prepared=body.changeSet===undefined?null:applyFinanceChanges(before,body.changeSet,body.effectivePeriod,live.uid);
      const candidate=prepared?.candidate??financeSnapshot(body.snapshot);
      if(!prepared)protectStructuredInputs(before,candidate);
      const changes=changedRights(live,p,before,candidate,!!prepared);
      if(prepared)candidate.calculationVersion=financeCalculationVersion(candidate);
      const beforeCalculation=calculateFinance(before),candidateCalculation=calculateFinance(candidate);
      const fields=prepared?.fields??changes.map(r=>({collection:r.collection,key:r.key,before:r.before,after:r.after}));
      const impact=previewImpact(beforeCalculation,candidateCalculation,fields);
      return {projectId:p,versionId:id,revision:v.revision,requestKey:body.requestKey,clientSequence:body.clientSequence??0,
        candidateSha256:financeDigest(candidate),calculationSha256:financeDigest(candidateCalculation),calculationVersion:candidateCalculation.calculationVersion,
        saveBlocked:!action&&!!blockedCalculation(beforeCalculation,candidateCalculation,candidate),
        effectivePeriod:prepared?.effectivePeriod??null,changes,calculationStatus:'calculated',persisted:false,before:beforeCalculation,candidate:candidateCalculation,
        ...impact,affectedYears:candidate.periods.filter(period=>impact.affectedPeriods.includes(period.key)).map(period=>({periodKey:period.key,label:period.label,ordinal:period.metadata.ordinal,calendarYear:period.metadata.calendarYear??null}))};
    });
  }
  function newBusinessErrors(before:ReturnType<typeof calculateFinance>,after:ReturnType<typeof calculateFinance>) {
    return after.issues.filter(issue=>issue.code==='missing_input'&&
      (before.outputs[issue.outputId]?.value!=null||issue.message==='Error: Landed unit cost cannot be negative.'));
  }
  function panelPreview(user:any,p:string,id:string,raw:unknown) {
    const {before,candidate,comparison,...response}=preview(user,p,id,raw);
    type DeltaMap=typeof comparison.metrics;
    const small=(values:DeltaMap)=>Object.fromEntries(Object.entries(values).map(([key,metric])=>{
      const amount=(value:typeof metric.before|typeof metric.delta)=>value?
        {value:value.value,displayValue:value.displayValue,status:value.status,unit:value.unit,
          ...('details' in value?{details:value.details}:{})}:null;
      return [key,{before:amount(metric.before),after:amount(metric.after),delta:amount(metric.delta)}];
    }));
    return {...response,candidate:{periods:candidate.periods},comparison:{compatible:comparison.compatible,metrics:small(comparison.metrics),
      periodic:comparison.periodic.map(small),budget:small(comparison.budget),products:Object.fromEntries(
        Object.entries(comparison.products).filter(([key])=>response.affectedProducts.includes(key)).map(([key,value])=>
          [key,{metrics:small(value.metrics),periodic:value.periodic.map(small)}]))}};
  }
  function readCalculation(user:any,p:string,id:string,expected?:number) {
      authorize(user,p);const v=version(p,id);if(expected!==undefined)revision(v,expected);
      const s=snapshot(p,id),result=calculateFinance(s);
      return {projectId:p,versionId:id,revision:v.revision,snapshotSha256:financeDigest(s),calculationSha256:financeDigest(result),calculation:result};
  }
  function calculation(user:any,p:string,id:string,expected?:number) {
    return store.transaction(()=>readCalculation(user,p,id,expected));
  }
  function projectCalculations(user:any,p:string) {
    return store.transaction(()=>{authorize(user,p);const st=state(p);return {projectId:p,...st,
      baseline:st.approvedBaselineId?readCalculation(user,p,st.approvedBaselineId):null,current:st.currentVersionId?readCalculation(user,p,st.currentVersionId):null};});
  }
  function workspace(user:any,p:string,query:URLSearchParams) {
    return store.transaction(()=>{
      const live=authorize(user,p),projectInfo=project(live,p);
      const requestedBaseline=query.get('baseline'),requestedVersion=query.get('version');
      const baselineId=projectInfo.versions.find(v=>v.id===requestedBaseline&&v.status==='frozen')?.id??projectInfo.approvedBaselineId;
      const currentId=projectInfo.versions.find(v=>v.id===requestedVersion)?.id??projectInfo.currentVersionId;
      const module=query.get('module'),isComparison=module==='compare',isDashboard=!module;
      const currencyOptions={...financeCurrencyScales,...projectInfo.versions.reduce<Record<string,number>>((codes,item)=>
        ({...codes,[item.currency]:item.currencyScale}),{})};
      const requestedDisplay=query.get('displayCurrency');
      const cache=new Map<string,ReturnType<typeof load>>();
      function load(id:string) {
        const details=projectInfo.versions.find(v=>v.id===id)!;
        const source=snapshot(p,id),bridge=isComparison?new FinanceBridgeInputs():undefined,calculation=calculateFinance(source,bridge);
        return {source,calculation,bridge,view:{details,fxBasis:financeFxBasis(source),...workspaceReport(source,calculation)}};
      }
      function selected(id:string|null) {
        if(!id)return null;
        const item=cache.get(id)??load(id);cache.set(id,item);return item;
      }
      const baseline=selected(baselineId),current=selected(currentId),active=current??baseline;
      const sources=new Map(active?.source.sources.map(source=>[source.key,source]));
      const businessModule=module==='factory-costs'?'factory':module;
      const versionIds=new Set(projectInfo.versions.map(version=>version.id));
      const from= query.get('from')??baselineId??projectInfo.versions[0]?.id??null;
      const to=query.get('to')??currentId??projectInfo.versions.at(-1)?.id??null;
      const aa=isComparison&&from&&versionIds.has(from)?selected(from):null;
      const zz=isComparison&&to&&versionIds.has(to)?selected(to):null;
      Object.assign(currencyOptions,baseline?.source.policy.currencyScales,current?.source.policy.currencyScales,
        aa?.source.policy.currencyScales,zz?.source.policy.currencyScales);
      if(requestedDisplay!==null&&!Object.hasOwn(currencyOptions,requestedDisplay))invalid('Unsupported finance display currency.');
      const displayCurrency=requestedDisplay??(isComparison?zz?.source.currency:active?.source.currency)??null;
      const shown=(item:typeof active)=>{
        if(!item||!isDashboard||!displayCurrency)return item;
        const calculation=displayFinance(item.calculation,item.source,displayCurrency,item.source,currencyOptions);
        return {...item,calculation,view:{details:item.view.details,fxBasis:item.view.fxBasis,...workspaceReport(item.source,calculation)}};
      };
      const displayedBaseline=shown(baseline),displayedCurrent=shown(current);
      const mode=financeFxMode(query.get('fxMode'));
      const fxComparison=aa&&zz&&displayCurrency?compareFinanceFx(
        {snapshot:aa.source,report:aa.calculation,inputs:aa.bridge!},{snapshot:zz.source,report:zz.calculation,inputs:zz.bridge!},
        displayCurrency,mode,query.get('cutoff'),query.get('compareProduct')):null;
      const comparisonReport=aa&&zz?(()=>{
        const result=financeBridges({snapshot:aa.source,report:aa.calculation,inputs:aa.bridge!},
          {snapshot:zz.source,report:zz.calculation,inputs:zz.bridge!},query.get('cutoff'),query.get('compareProduct'));
        const {links,changes}=comparisonSources(aa.source,zz.source,aa.calculation,zz.calculation);
        const withLinks=(bridge:NonNullable<typeof result.data>['profit'])=>bridge&&({...bridge,byDriver:bridge.byDriver.map(row=>({...row,
          details:row.details.map(({evidence,...item})=>({...item,before:links('before',evidence.before,item.period),
            after:links('after',evidence.after,item.period)}))}))});
        const changesInView=changes.filter(change=>!result.product||[change.before,change.after]
          .some(location=>location&&(!location.product||location.product===result.product)));
        return {...result,before:aa.view.details,after:zz.view.details,changes:changesInView,
          data:result.data&&{...result.data,profit:withLinks(result.data.profit),npv:withLinks(result.data.npv)}};
      })():null;
      const sourceKind=query.get('traceKind'),traceKey=query.get('traceKey'),traceRevision=query.get('traceRevision');
      const sourceTrace=active&&traceKey&&(sourceKind==='input'||sourceKind==='event'||sourceKind==='source'||sourceKind==='policy')?
        financeSourceIndex(active.source).details(sourceKind,traceKey,query.get('tracePeriod')):null;
      const sourceRevisionChanged=!!(sourceTrace&&traceRevision!==null&&traceRevision!==String(active?.view.details.revision));
      const businessSections=['commercial','bom','factory'];
      const businessRows=active&&businessSections.includes(businessModule??'')?businessInputs(active.source):[];
      const commercial=active&&module==='commercial'?commercialWorkspace(active.source,active.calculation,businessRows):null;
      const materialSchedule=active&&module==='bom'?materialCostSchedule(active.calculation,businessRows):[];
      const effectivePeriod=active?.view.periods.find(item=>item.key===query.get('period'))?.key??active?.view.periods[1]?.key;
      const factoryCosts=active&&module==='factory-costs'&&effectivePeriod?
        factoryCostWorkspace(active.source,active.calculation,businessRows,effectivePeriod):[];
      const operationPeriod=effectivePeriod===active?.view.periods[0]?.key?active?.view.periods[1]?.key:effectivePeriod;
      const operations=active&&module==='operations'&&operationPeriod?operationsWorkspace(active.source,active.calculation,operationPeriod,query.get('product')):null;
      const operationAssets=active&&operations?capitalAssets(active.source).flatMap(row=>{
        const asset=row.conversion.capital;
        return asset.lineId?[{line:asset.lineId,key:row.key,products:asset.allocations.map(item=>item.productKey)}]:[];
      }):[];
      const canOperate=!!operations&&access.can(live,'financePreview',p)&&access.can(live,'financeOperationsEdit',p);
      const development=active&&isDevelopmentModule(module)&&supportsDevelopment(active.source)?
        developmentWorkspace(active.source,active.calculation,module,query.get('period'),query.get('product'),query.get('source')):null;
      const developmentRights=Object.fromEntries((['engineering','prototypes','validation'] as const).map(key=>
        [key,!!development&&access.can(live,'financePreview',p)&&access.can(live,financeEditCapabilities[key],p)]));
      const capital=active&&(module==='investment'&&supportsCapital(active.source)||
        module==='returns'&&(supportsCapital(active.source)||active.source.policy.rules.model==='cash_series'))?
        capitalWorkspace(active.source,active.calculation,query.get('product'),query.get('source'),module==='investment'):null;
      const capitalRights={investment:!!capital&&access.can(live,'financePreview',p)&&access.can(live,'financeInvestmentEdit',p),
        returns:!!capital&&!!active&&supportsCapital(active.source)&&access.can(live,'financePreview',p)&&access.can(live,'financeReturnsEdit',p)};
      const budget=active&&module==='budget'?budgetWorkspace(active.source,active.calculation,live.uid):null;
      const budgetEdit=!!budget&&access.can(live,'financePreview',p)&&access.can(live,'financeBudgetEdit',p);
      const budgetRights={edit:budgetEdit,setup:budgetEdit&&access.can(live,'financeVersionEdit',p),
        confirm:!!budget&&access.can(live,'financeApprove',p)};
      const budgetActors=budget?Object.fromEntries([...new Set(budget.scopes.flatMap(scope=>scope.postings.flatMap(({entry})=>
        entry.type==='allocation'||entry.type==='cost'?[...entry.makers,...(entry.confirmedBy?[entry.confirmedBy]:[])]:[])))].map(uid=>
        [uid,accountByUid(store,uid)?.name??uid])):{};
      const visibleBusiness=businessRows.filter(input=>input.module===businessModule&&(input.periodKey===effectivePeriod||input.conversion.businessField==='tooling'));
      const applicablePeriods=new Map<string,string[]>();
      const scopedBusiness=new Map<string,Map<string,typeof visibleBusiness[number]>>();
      for(const row of businessRows){
        const identity=row.conversion.businessGroup+':'+row.metricKey;
        const periods=applicablePeriods.get(identity)??[];
        periods.push(row.periodKey);applicablePeriods.set(identity,periods);
      }
      for(const row of visibleBusiness){
        const group=row.conversion.businessGroup+':'+row.periodKey;
        const items=scopedBusiness.get(group)??new Map();
        items.set(row.conversion.businessField,row);scopedBusiness.set(group,items);
      }
      const legacy=active?.source.inputs.filter(input=>!isBusiness(input)&&supportsFinanceDriver(active.source,input.metricKey)&&!replacedFinanceDriver(active.source,input))??[];
      const inputs=[...legacy,...visibleBusiness].map(input=>{
        const source=sources.get(input.sourceKey);
        const business=isBusiness(input)?input.conversion:null;
        const applicable=business?applicablePeriods.get(business.businessGroup+':'+input.metricKey)??[]:null;
        const fx=business&&input.currency?businessFx(active!.source,input.currency,input.periodKey):null;
        const siblings=business?scopedBusiness.get(business.businessGroup+':'+input.periodKey):null;
        const quote=siblings?.get('part_price'),quantity=siblings?.get('part_quantity'),adjustment=siblings?.get('landed_adjustment');
        const costFx=business?.businessField==='part_price'?fx:null;
        const adjustmentFx=adjustment?.currency?businessFx(active!.source,adjustment.currency,adjustment.periodKey):null;
        const landed=quote&&quantity&&adjustment&&costFx&&adjustmentFx?Decimal.from(quantity.value)
          .mul(Decimal.from(quote.value).mul(costFx.rate).add(Decimal.from(adjustment.value).mul(adjustmentFx.rate))).text(4):null;
        return {key:input.key,metricKey:input.metricKey,module:input.module,unit:input.unit,value:input.value,
          productKey:input.productKey,marketKey:input.marketKey,periodKey:input.periodKey,lineKey:input.lineKey,currency:input.currency,
          valueKind:input.valueKind,business,applicable,landed,label:business?businessFields[business.businessField][1]:null,
          fx:fx?{rate:fx.rate.text(),source:[fx.source?.sheet,fx.source?.cell].filter(Boolean).join('!')||fx.source?.externalKey||
            (active?.source.policy.fx&&input.currency!==(archived(active.source)?'CNY':active.source.currency)?'Version FX snapshot':null)}:null,
          overrides:input.conversion.p06Overrides??{},acrossPeriods:input.metricKey.startsWith('cqa.operations.'),
          source:source?{key:source.key,sheet:source.sheet,cell:source.cell,observation:source.observation,reference:source.externalKey}:null,
          canPreview:!business?.referenceOnly&&access.can(live,'financePreview',p)&&access.can(live,financeEditCapabilities[input.module],p)};
      });
      const canAdd=active&&active.view.details.status==='draft'&&businessSections.includes(businessModule??'')&&
        (archived(active.source)?businessModule==='bom':active.source.policy.rules.model==='manufacturing')&&
        access.can(live,'financePreview',p)&&access.can(live,financeEditCapabilities[businessModule as FinanceModule],p);
      const canClone=active?.view.details.status==='frozen'&&access.can(live,'financeVersionEdit',p)&&
        [...new Set([...active.source.inputs,...active.source.events].map(row=>row.module))].every(module=>access.can(live,financeEditCapabilities[module],p));
      return {...projectInfo,title:store.get('projects',p).title,baseline:displayedBaseline?.view??null,current:displayedCurrent?.view??null,inputs,
        businessPeriod:effectivePeriod??null,archived:active?archived(active.source):false,canAdd:!!canAdd,canClone:!!canClone,businessFields,commercial,materialSchedule,factoryCosts,
        operations,operationPeriod,operationAssets,canOperate,canCalibrate:canOperate&&access.can(live,'financeApprove',p),development,developmentRights,capital,capitalRights,
        budget,budgetRights,budgetActors,comparisonReport,fxComparison,sourceTrace,sourceRevisionChanged,displayCurrency,currencyOptions,
        fxCurrencyOptions:{...financeCurrencyScales,...active?.source.policy.currencyScales},
        fxBasis:active?financeFxBasis(active.source):null,
        canEditFx:!!active&&active.view.details.status==='draft'&&!archived(active.source)&&access.can(live,'financeVersionEdit',p),
        canCloneFx:!!canClone&&!!active&&!archived(active.source),
        displayFxMissing:isDashboard&&[displayedBaseline,displayedCurrent].some(item=>item?.calculation.issues.some(issue=>issue.code==='missing_fx')),
        markets:active?.source.markets.map(({key,label,metadata})=>({key,label,productKey:metadata.productKey??null}))??[],
        currencies:active?.source.policy.currencyScales??{},
        comparison:!isComparison&&displayedBaseline&&displayedCurrent?workspaceComparison(displayedBaseline.calculation,displayedCurrent.calculation):null,
        selectionAdjusted:!!((requestedBaseline&&requestedBaseline!==baselineId)||(requestedVersion&&requestedVersion!==currentId))};
    });
  }
  function financeFxMode(value:unknown):FinanceFxMode {
    if(value===null||value===undefined)return 'own';
    if(!financeFxModes.includes(value as FinanceFxMode))return invalid('Invalid finance FX comparison mode.');
    return value as FinanceFxMode;
  }
  function compare(user:any,p:string,id:string,raw:unknown) {
    return store.transaction(()=>{authorize(user,p);const body=financeCommand(raw,['revision','otherVersionId','otherRevision','fxMode','displayCurrency','cutoff','product']);financeKey(body.otherVersionId);
      const before=readCalculation(user,p,id,financeRevision(body.revision)),after=readCalculation(user,p,body.otherVersionId,financeRevision(body.otherRevision));
      if(body.fxMode!==undefined||body.displayCurrency!==undefined){
        const a=snapshot(p,id),b=snapshot(p,body.otherVersionId),target=body.displayCurrency??b.currency;
        if(typeof target!=='string'||![financeCurrencyScales,a.policy.currencyScales,b.policy.currencyScales].some(codes=>Object.hasOwn(codes,target)))
          return invalid('Unsupported finance display currency.');
        const side=(snapshot:FinanceSnapshot)=>{const inputs=new FinanceBridgeInputs();return {snapshot,inputs,report:calculateFinance(snapshot,inputs)};};
        return {projectId:p,before,after,...compareCalculations(before.calculation,after.calculation),
          fx:compareFinanceFx(side(a),side(b),target,financeFxMode(body.fxMode),body.cutoff??null,body.product??null)};
      }
      return {projectId:p,before,after,...compareCalculations(before.calculation,after.calculation)};});
  }
  function transition(user:any,p:string,id:string,raw:unknown,context:WriteContext,op:'freeze'|'activate') {
    return store.transaction(()=>{
      const live=authorize(user,p,op==='freeze'?'financeApprove':'financeVersionEdit'),body=financeCommand(raw,['revision','stateRevision']);
      return receipt(live,p,op+':'+id,body,()=>{
        const v=version(p,id),beforeState=state(p);revision(v,body.revision);
        if(beforeState.stateRevision!==financeRevision(body.stateRevision))invalid('Finance project state conflict',409);
        const s=snapshot(p,id),before={snapshot:s,status:v.status,...beforeState};let rev=v.revision;
        if(op==='freeze') {
          if(v.status!=='draft')invalid('Already frozen; use the original request key to retry',409);
          db.prepare("UPDATE finance_versions SET status='frozen',revision=revision+1,approved_uid=?,approved_at=?,updated_uid=?,updated_at=? WHERE project_id=? AND id=?")
            .run(live.uid,new Date().toISOString(),live.uid,new Date().toISOString(),p,id);rev++;
        }
        const approved=op==='freeze'?id:beforeState.approvedBaselineId,current=op==='activate'?id:beforeState.currentVersionId;
        db.prepare('INSERT INTO finance_project_state(project_id,approved_baseline_id,current_version_id,revision) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET approved_baseline_id=excluded.approved_baseline_id,current_version_id=excluded.current_version_id,revision=excluded.revision')
          .run(p,approved,current,beforeState.stateRevision+1);
        return evidence(live,p,id,op,body,before,{snapshot:s,status:version(p,id).status,...state(p)},v.revision,rev,context);
      });
    });
  }
  /** Offline CQA import only. No HTTP path accepts this larger contract or caller-supplied validation. */
  function importBaseline(user:any,p:string,id:string,raw:unknown,context:WriteContext) {
    return store.transaction(()=>{
      const live=authorize(user,p,'financeVersionEdit');authorize(live,p,'financeApprove');authorize(live,p,'financePreview');
      const body=financeCommand(raw,['snapshot','revision','stateRevision','sourceSha256','mappingVersion','validatedSnapshotSha256']);
      return receipt(live,p,'cqa_import:'+id,body,()=>{
        const v=version(p,id),st=state(p);revision(v,body.revision);
        if(v.status!=='draft')invalid('Import requires an empty draft version',409);
        if(st.stateRevision!==financeRevision(body.stateRevision))invalid('Finance project state conflict',409);
        const before=snapshot(p,id);
        if(before.sources.length||before.inputs.length||before.events.length)invalid('Import target is not empty; create a separate version',409);
        const candidate=financeSnapshot(body.snapshot,50000),rules=candidate.policy.rules;
        if(body.mappingVersion!=='P05.1'||rules.importFormat!=='cqa-import-P05.1'||rules.sourceSha256!==body.sourceSha256||
          !/^[a-f0-9]{64}$/.test(body.sourceSha256)||candidate.sources.some(r=>r.fingerprint!==body.sourceSha256)||
          financeDigest(candidate)!==body.validatedSnapshotSha256)invalid('CQA import validation binding failed',409);
        changedRights(live,p,before,candidate);
        replaceContent(p,id,candidate);
        const now=new Date().toISOString();
        db.prepare("UPDATE finance_versions SET name=?,currency=?,currency_scale=?,basis=?,as_of=?,dictionary_version=?,calculation_version=?,policy_json=?,status='frozen',revision=revision+1,updated_uid=?,updated_at=?,approved_uid=?,approved_at=? WHERE project_id=? AND id=?")
          .run(candidate.name,candidate.currency,candidate.currencyScale,candidate.basis,candidate.asOf,candidate.dictionaryVersion,candidate.calculationVersion,canonicalFinance(candidate.policy),live.uid,now,live.uid,now,p,id);
        db.prepare('INSERT INTO finance_project_state(project_id,approved_baseline_id,current_version_id,revision) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET approved_baseline_id=excluded.approved_baseline_id,current_version_id=excluded.current_version_id,revision=excluded.revision')
          .run(p,id,st.currentVersionId,st.stateRevision+1);
        return evidence(live,p,id,'cqa_import',body,{snapshot:before,status:'draft',...st},{snapshot:candidate,status:'frozen',...state(p)},v.revision,v.revision+1,context);
      });
    });
  }
  function changes(user:any,p:string,id:string) {
    authorize(user,p);version(p,id);
    return {changes:db.prepare('SELECT * FROM finance_changes WHERE project_id=? AND version_id=? ORDER BY occurred_at,id').all(p,id).map(r=>({
      id:r.id,operation:r.operation,revisionBefore:r.revision_before,revisionAfter:r.revision_after,actorUid:r.actor_uid,reason:r.reason,occurredAt:r.occurred_at,
      beforeSha256:r.before_sha256,afterSha256:r.after_sha256,payload:parse(r.payload_json)
    }))};
  }
  return {projects,project,get,create,save,preview,previewFx,panelPreview,calculation,projectCalculations,workspace,compare,changes,importBaseline,freeze:(u:any,p:string,id:string,b:unknown,c:WriteContext)=>transition(u,p,id,b,c,'freeze'),
    activate:(u:any,p:string,id:string,b:unknown,c:WriteContext)=>transition(u,p,id,b,c,'activate')};
}
