import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
export function committedRuntimeVersion() {
  const gitArgs=['-c','safe.directory='+repositoryRoot];
  if(execFileSync('git',[...gitArgs,'status','--porcelain','--','server.ts','lib','src','scripts','config','package.json','pnpm-lock.yaml'],{cwd:repositoryRoot,encoding:'utf8'}).trim())throw Error('Commit runtime/tool/policy changes before backup');
  return execFileSync('git',[...gitArgs,'rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim();
}
