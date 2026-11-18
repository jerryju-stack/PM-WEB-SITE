import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {Store} from './database.ts';
import {financeService,financeDigest} from './finance.ts';
import {policy} from './policy.ts';
import {accountByUid} from './accounts.ts';
import type {WriteContext} from './audit.ts';
import {invalid} from './contracts.ts';
import {CqaWorkbook,buildCqaCandidate,CQA_MAPPING_VERSION} from './finance-cqa.ts';
import type {CqaCandidate} from './finance-cqa.ts';
const digest=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
export const cqaRequestKey=(preview:CqaPreview)=>'cqa:'+digest(preview.projectId+':'+preview.versionId+':'+preview.sourceSha256+':'+preview.mappingVersion);
export type CqaPreview={
  format:'cqa-preview-P05.1';id:string;actorUid:string;projectId:string;versionId:string;revision:number;stateRevision:number;dataBinding:string;
  action:'freeze_cqa_baseline';sourceSha256:string;mappingVersion:string;candidateSha256:string;snapshotSha256:string;createdAt:string
};
export function cqaImport(store:Store) {
  const finance=financeService(store);
  function actor(user:any,p:string) {
    const live=user&&accountByUid(store,user.uid);if(!live)invalid('Please sign in',401);
    const access=policy(store);
    for(const cap of ['financeRead','financeVersionEdit','financePreview','financeApprove'] as const)access.requireCap(live,cap,p);
    return live;
  }
  function binding(){return digest(resolve(store.directory));}
  function preview(user:any,p:string,v:string,bytes:Uint8Array,matrix:any) {
    const live=actor(user,p),target=finance.get(live,p,v);
    if(target.status!=='draft'||target.snapshot.inputs.length||target.snapshot.sources.length||target.snapshot.events.length)invalid('Select an empty draft for a new CQA baseline',409);
    const candidate=buildCqaCandidate(new CqaWorkbook(bytes),matrix,target.snapshot);
    if(candidate.report.issues.some((i:any)=>i.status==='blocking')||candidate.report.checks.some((c:any)=>c.status!=='passed'))invalid('CQA scope validation failed',400);
    const encoded=JSON.stringify(candidate);
    const out:CqaPreview={format:'cqa-preview-P05.1',id:randomUUID(),actorUid:live.uid,projectId:p,versionId:v,revision:target.revision,stateRevision:target.stateRevision,dataBinding:binding(),
      action:'freeze_cqa_baseline',sourceSha256:candidate.sourceSha256,mappingVersion:CQA_MAPPING_VERSION,candidateSha256:digest(encoded),snapshotSha256:financeDigest(candidate.snapshot),createdAt:new Date().toISOString()};
    return {preview:out,candidate,encoded,previewDigest:financeDigest(out)};
  }
  function check(user:any,preview:CqaPreview,candidate:CqaCandidate,previewDigest:string) {
    const live=actor(user,preview.projectId);
    if(preview.format!=='cqa-preview-P05.1'||preview.action!=='freeze_cqa_baseline'||preview.actorUid!==live.uid||preview.dataBinding!==binding()||
      financeDigest(preview)!==previewDigest||candidate.format!=='cqa-import-P05.1'||preview.sourceSha256!==candidate.sourceSha256||
      preview.mappingVersion!==candidate.mappingVersion||preview.snapshotSha256!==financeDigest(candidate.snapshot))invalid('CQA preview binding failed',409);
    return live;
  }
  function confirm(user:any,preview:CqaPreview,candidate:CqaCandidate,validation:any,previewDigest:string,context:WriteContext) {
    const live=check(user,preview,candidate,previewDigest);
    if(validation.status!=='passed'||validation.sourceSha256!==preview.sourceSha256||validation.candidateFileSha256!==preview.candidateSha256||
      validation.websiteCalculation!=='not_implemented')invalid('Run and review independent CQA validation first',409);
    return finance.importBaseline(live,preview.projectId,preview.versionId,{
      requestKey:cqaRequestKey(preview),
      reason:'Import independently validated CQA archive as a frozen historical baseline',
      snapshot:candidate.snapshot,revision:preview.revision,stateRevision:preview.stateRevision,sourceSha256:preview.sourceSha256,
      mappingVersion:preview.mappingVersion,validatedSnapshotSha256:preview.snapshotSha256
    },context);
  }
  return {preview,check,confirm};
}
export function saveCqaPreview(directory:string,result:ReturnType<ReturnType<typeof cqaImport>['preview']>) {
  const output=join(directory,'finance-imports',result.preview.id);mkdirSync(output,{recursive:true});
  writeFileSync(join(output,'preview.json'),JSON.stringify(result.preview,null,2)+'\n',{flag:'wx'});
  writeFileSync(join(output,'candidate.json'),result.encoded,{flag:'wx'});
  writeFileSync(join(output,'annual-inputs.json'),JSON.stringify(result.candidate.report.annual,null,2)+'\n',{flag:'wx'});
  const columns=['productKey','originalPeriod','basis','metricKey','excelValue','excelState','currency','sourceUnit','coefficient','scale','websiteValue','websiteStatus','sheet','cell','sourceKey'];
  const csv=(value:any)=>{const raw=String(value??''),safe=/^[=+@\t\r]|^-[^0-9.]/.test(raw)?"'"+raw:raw;return '"'+safe.replaceAll('"','""')+'"';};
  for(const product of result.candidate.snapshot.products) {
    const rows=result.candidate.report.annual.filter((r:any)=>r.productKey===product.key).map((r:any)=>({...r,coefficient:r.normalizedValue?.coefficient??null,scale:r.normalizedValue?.scale??null}));
    writeFileSync(join(output,'annual-'+product.key+'.csv'),'\uFEFF'+columns.map(csv).join(',')+'\r\n'+rows.map((r:any)=>columns.map(c=>csv(r[c])).join(',')).join('\r\n')+'\r\n',{flag:'wx'});
  }
  return output;
}
export function loadCqaPreview(directory:string,id:string) {
  if(!/^[a-f0-9-]{36}$/.test(id))invalid('Invalid CQA preview ID');
  const output=join(directory,'finance-imports',id),preview=JSON.parse(readFileSync(join(output,'preview.json'),'utf8')) as CqaPreview,bytes=readFileSync(join(output,'candidate.json'));
  if(bytes.length>80*1024*1024||digest(bytes)!==preview.candidateSha256)invalid('CQA candidate file changed',409);
  return {output,preview,candidate:JSON.parse(bytes.toString('utf8')) as CqaCandidate};
}
