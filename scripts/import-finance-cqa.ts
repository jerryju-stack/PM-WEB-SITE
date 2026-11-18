/** Offline only: a stopped DATA_DIR, current permanent account, and explicit preview digest. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {openStore} from '../lib/database.ts';
import {dataLock} from '../lib/data-lock.ts';
import {cqaImport,cqaRequestKey,saveCqaPreview,loadCqaPreview} from '../lib/finance-cqa-import.ts';
import {financeDigest} from '../lib/finance.ts';
import {backupSnapshot} from '../lib/snapshots.ts';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
export function resolveCqaSource(matrix:any,explicit?:string) {
  const configured=process.env.CQA_SAMPLE_XLSX||explicit;
  const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
  if(!configured)throw Error('Select an authorized CQA workbook with --source or CQA_SAMPLE_XLSX');
  if(hash(configured)!==matrix.sample.sha256)throw Error('Configured CQA source differs from approved P01 fingerprint');
  return resolve(configured);
}
export function pythonExecutable() {
  if(process.env.CQA_PYTHON)return process.env.CQA_PYTHON;
  const cached=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  return existsSync(cached)?cached:'python3';
}
export function runCqaCommand(phase:string,options:Record<string,string>) {
  const directory=resolve(options.data??''),matrix=JSON.parse(readFileSync(join(root,'docs/validation/project-finance/P01/source-matrix.json'),'utf8'));
  if(!options.data||!existsSync(join(directory,'project-station.sqlite')))throw Error('Use an existing local DATA_DIR');
  const lock=dataLock(directory,'offline-cqa-'+phase);
  let store:ReturnType<typeof openStore>;
  try{store=openStore(directory);}catch(error){lock.release();throw error;}
  try {
    const user=store.get('users',options.actor??'');if(!user)throw Error('Select an existing account with --actor');
    const imports=cqaImport(store);
    if(phase==='preview') {
      if(!options.project||!options.version)throw Error('Provide --project and --version for an empty draft');
      const source=resolveCqaSource(matrix,options.source),bytes=readFileSync(source),result=imports.preview(user,options.project,options.version,bytes,matrix);
      const output=saveCqaPreview(directory,result);
      // Source path stays in this private, DATA_DIR-local review folder.
      writeFileSync(join(output,'source.json'),JSON.stringify({path:source,sourceSha256:result.preview.sourceSha256})+'\n',{flag:'wx'});
      return {phase,previewId:result.preview.id,previewDigest:result.previewDigest,action:result.preview.action,counts:result.candidate.report.counts,privateOutput:output};
    }
    if(!options.preview||!options.digest)throw Error('Provide --preview and the reviewed --digest');
    const loaded=loadCqaPreview(directory,options.preview);
    imports.check(user,loaded.preview,loaded.candidate,options.digest);
    const sourceInfo=JSON.parse(readFileSync(join(loaded.output,'source.json'),'utf8'));
    const source=resolveCqaSource(matrix,sourceInfo.path);
    const sourceSha=createHash('sha256').update(readFileSync(source)).digest('hex');
    if(sourceSha!==loaded.preview.sourceSha256)throw Error('Source changed after preview');
    if(phase==='validate') {
      const result=execFileSync(pythonExecutable(),['-X','utf8',join(root,'scripts/validate-finance-cqa.py'),'--source',source,'--candidate',join(loaded.output,'candidate.json'),
        '--output',join(loaded.output,'validation.json'),'--controls-output',join(loaded.output,'excel-controls.json')],{encoding:'utf8',maxBuffer:2*1024*1024,windowsHide:true});
      return {phase,previewId:loaded.preview.id,previewDigest:options.digest,...JSON.parse(result)};
    }
    if(phase!=='confirm')throw Error('Use preview, validate or confirm');
    const validation=JSON.parse(readFileSync(join(loaded.output,'validation.json'),'utf8'));
    if(store.db.prepare('SELECT 1 FROM finance_receipts WHERE project_id=? AND actor_uid=? AND request_key=?').get(loaded.preview.projectId,user.uid,cqaRequestKey(loaded.preview))) {
      const receipt=imports.confirm(user,loaded.preview,loaded.candidate,validation,options.digest,{actorId:user.uid,actorUid:user.uid,actorName:user.name,requestId:'cqa-retry-'+loaded.preview.id});
      return {phase,previewId:loaded.preview.id,receipt,replayed:true,privateOutput:loaded.output};
    }
    // Backup requires the directory lock itself. Release the offline lock only while the existing
    // backup mechanism owns it; reacquire before reopening and rechecking the current actor/revisions.
    store.db.close();lock.release();
    const backup=join(dirname(directory),basename(directory)+'-p05-backup-'+Date.now());
    const codeVersion=execFileSync('git',['-c','safe.directory='+root,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    backupSnapshot(directory,backup,codeVersion+'+P05-working-tree');
    const confirmLock=dataLock(directory,'offline-cqa-confirm');
    let current:ReturnType<typeof openStore>;
    try{current=openStore(directory);}catch(error){confirmLock.release();throw error;}
    try {
      const live=current.get('users',options.actor),context={actorId:live?.uid??'',actorUid:live?.uid,actorName:live?.name??'',requestId:'cqa-'+loaded.preview.id};
      const receipt=cqaImport(current).confirm(live,loaded.preview,loaded.candidate,validation,options.digest,context);
      writeFileSync(join(loaded.output,'receipt.json'),JSON.stringify({receipt,backup},null,2)+'\n');
      return {phase,previewId:loaded.preview.id,receipt,backup,privateOutput:loaded.output};
    }finally{current.db.close();confirmLock.release();}
  }finally {
    if(store.db.isOpen)store.db.close();
    if(existsSync(join(directory,'.station-lock')))lock.release();
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [phase,...args]=process.argv.slice(2),options:Record<string,string>={};
    for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])throw Error('Options require --name value');options[args[i].slice(2)]=args[i+1];}
    console.log(JSON.stringify(runCqaCommand(phase,options),null,2));
  }catch(error:any){console.error('P05: '+error.message);process.exitCode=1;}
}
