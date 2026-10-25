import { resolve } from 'node:path';
import { loadPolicy, scheduleAt, policyStatus, runPolicyBackup, retainBackups } from '../lib/backup-policy.ts';
import { committedRuntimeVersion } from '../lib/runtime-version.ts';
const [command,...args]=process.argv.slice(2),options=new Map<string,string>();
try {
  for(let n=0;n<args.length;n+=2){if(!args[n].startsWith('--')||!args[n+1]||args[n+1].startsWith('--'))throw Error('Options require values');options.set(args[n].slice(2),args[n+1]);}
  const required=(key:string)=>{const value=options.get(key);if(!value)throw Error('Missing --'+key);return value;};
  const policy=loadPolicy(options.get('policy')),root=()=>resolve(required('root'));
  let result:unknown;
  if(command==='schedule')result={policy,...scheduleAt(policy)};
  else if(command==='status'){result=policyStatus(root(),policy);if(!(result as any).healthy)process.exitCode=2;}
  else if(command==='run') {
    if(required('offline-confirmed')!=='yes')throw Error('All writers must be stopped first');
    const scheduled=options.get('scheduled')==='yes';
    if(!scheduled&&options.get('manual')!=='yes')throw Error('Choose --scheduled yes or explicit --manual yes');
    const slot=scheduleAt(policy);
    if(scheduled&&!slot.withinWindow)result={skipped:true,reason:'OUTSIDE_APPROVED_WINDOW',...slot};
    else {
      let alreadyCompleted=false;
      if(scheduled)try{const state=policyStatus(root(),policy).state;alreadyCompleted=Boolean(state?.lastSuccessAt&&Date.parse(state.lastSuccessAt)>=Date.parse(slot.latestWindowAt));}catch(error:any){if(error.code!=='ENOENT')throw error;}
      result=alreadyCompleted?{skipped:true,reason:'WINDOW_ALREADY_COMPLETED'}:runPolicyBackup(resolve(required('data')),root(),committedRuntimeVersion(),policy);
    }
  }else if(command==='retention') {
    const apply=options.get('apply')==='yes';
    if(apply&&options.get('delete-expired-confirmed')!=='yes')throw Error('Permanent deletion requires --delete-expired-confirmed yes');
    result=retainBackups(resolve(required('data')),root(),policy,apply);
  }else throw Error('Commands: run status schedule retention');
  console.log(JSON.stringify({ok:!process.exitCode,result},null,2));
}catch(error:any){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
