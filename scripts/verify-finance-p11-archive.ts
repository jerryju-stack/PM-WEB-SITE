/** Reconciles P11 against authorized P05 sources and keeps project amounts in .deploy. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {calculateFinance} from '../lib/finance-calculation.ts';
import type {FinanceSnapshot} from '../lib/finance-contracts.ts';
import {Decimal,sum,ZERO} from '../lib/finance-decimal.ts';
import {pythonExecutable,resolveCqaSource} from './import-finance-cqa.ts';

const p05=JSON.parse(readFileSync('.deploy/finance-p05/latest-run.json','utf8'));
const matrix=JSON.parse(readFileSync('docs/validation/project-finance/P01/source-matrix.json','utf8'));
const {snapshot}=JSON.parse(readFileSync(join(p05.privateOutput,'candidate.json'),'utf8')) as {snapshot:FinanceSnapshot};
const directory=resolve('.deploy/finance-p11/archive-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(directory,{recursive:true});
const reports={USD:calculateFinance({...snapshot,currency:'USD'}),CNY:calculateFinance({...snapshot,currency:'CNY'})};
const raw=join(directory,'reports.json'),checked=join(directory,'reconciliation.json');
writeFileSync(raw,JSON.stringify(reports));
execFileSync(pythonExecutable(),['-X','utf8','scripts/validate-finance-p06.py','--source',resolveCqaSource(matrix),'--reports',raw,'--output',checked],
  {stdio:'pipe',maxBuffer:1024*1024});
const original=JSON.parse(readFileSync(checked,'utf8'));
const sources=new Map(snapshot.sources.map(row=>[row.sheet+'!'+row.cell,row.metadata.excel as {state:'number'|'blank';value:string}|undefined]));
const rawAmount=(sheet:string,cell:string)=>{
  const source=sources.get(sheet+'!'+cell);
  if(source?.state==='blank')return ZERO;
  assert.equal(source?.state,'number',sheet+'!'+cell);
  return Decimal.from(source!.value).mul(Decimal.from(1000));
};
const close=(value:string|null,expected:Decimal,label:string)=>{
  assert.ok(value,label);
  assert.ok(Decimal.from(value).sub(expected).abs().cmp(Decimal.from('0.000001'))<0,label);
};
const products=snapshot.products.filter(p=>p.metadata.active!==false).map(product=>{
  const sheet=String(product.metadata.externalKey);
  for(const [i,column] of [...'DEFGHIJKLMN'].entries()){
    const paid=sum([294,295,296,297,298,299,300].map(row=>rawAmount(sheet,column+row))),received=rawAmount(sheet,column+'430');
    const website=reports.CNY.products[product.key].periodic[i];
    close(website.capital_payments.value,paid,sheet+' capex '+column);
    close(website.capital_receipts.value,received,sheet+' recovery '+column);
    close(website.capital_net.value,rawAmount(sheet,column+'302'),sheet+' net '+column);
  }
  return {product:product.key,financials:sheet,periods:11,checks:['Capital payments 294–300','Compensation 430','Net capital 302','CNY and USD project returns']};
});
const report={step:'P11',status:original.status,source:'Authorized P05 workbook and frozen source snapshot',sourceReadOnly:true,products,
  currencies:original.currencies,archiveChecks:original.checks,capitalAdditionalChecks:products.length*11*3,aggregate:'Four-product cash and project NPV / IRR / payback / peak',
  privateAmountsExportedToRepository:false};
if(process.argv.includes('--record')){
  const publicDir='docs/validation/project-finance/P11';
  mkdirSync(publicDir,{recursive:true});
  writeFileSync(join(publicDir,'archive-checks.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));
