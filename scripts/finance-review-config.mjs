import {join} from 'node:path';
import {readFile} from 'node:fs/promises';

export async function financeReviewConfig(step,defaultPort) {
  const p14=process.env.FINANCE_P14_INDEX;
  if(!p14)return {base:'http://127.0.0.1:'+defaultPort,
    run:JSON.parse(await readFile('.deploy/finance-'+step+'/latest-run.json','utf8')),
    evidence:'docs/validation/project-finance/'+step.toUpperCase()};
  const suite=JSON.parse(await readFile(p14,'utf8')),run=suite.cases[step];
  if(!run)throw Error('Unknown P14 review case '+step);
  return {base:'http://127.0.0.1:'+suite.port,run,evidence:join(run.directory,'workflow-evidence',step)};
}
