import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'station-p04-evidence-')),migrationPath=join(temporary,'migration.json');
const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','tests/finance-data.test.ts','tests/finance-http.test.ts'],{
  cwd:root,encoding:'utf8',env:{...process.env,P04_EVIDENCE_PATH:migrationPath},maxBuffer:10*1024*1024
});
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
const count=(name:string)=>Number(new RegExp('^# '+name+' ([0-9]+)','m').exec(result.stdout)?.[1]??0);
const summary={step:'P04',sample:'synthetic only',recordedAt:new Date().toISOString(),node:process.version,
  command:'node --experimental-strip-types scripts/verify-finance-p04.ts --record',
  tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),
  checks:['schema 10 to 11 and failed-DDL rollback','legacy rows preserved and finance empty','canonical fixed decimal and currency scales',
    'source provenance and separate budget/incurred/payment events','administrator, Viewer, duty editor and explicit approver',
    'cross-project and cross-module denial','live revocation including in-flight HTTP body and successful receipt retries',
    'read/preview/write HTTP enforcement and public card redaction','concurrent revision and project-state conflicts',
    'draft clone, immutable frozen baseline and audit evidence','idempotent receipts and changed-body conflict',
    'audit/receipt failure atomic rollback and successful retry','backup/restore table hashes and tampered evidence rejection']};
if(!summary.tests||summary.failed||summary.skipped)throw Error('Incomplete P04 verification');
if(process.argv.includes('--record')) {
  const output=join(root,'docs/validation/project-finance/P04');mkdirSync(output,{recursive:true});
  writeFileSync(join(output,'migration-evidence.json'),readFileSync(migrationPath));
  writeFileSync(join(output,'verification.json'),JSON.stringify(summary,null,2)+'\n');
}
console.log(JSON.stringify(summary,null,2));
