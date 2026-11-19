import {financeReviewConfig} from './finance-review-config.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const {base,run,evidence}=await financeReviewConfig('p10',18750);
const accounts=JSON.parse(await readFile(run.credentials,'utf8'));
const privateDir=join(run.directory,'browser');
await mkdir(evidence,{recursive:true});await mkdir(privateDir,{recursive:true});
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-proxy-server']});
const checks=[],reconciliation={};
const root='/projects/'+run.synthetic+'/finance';
function check(name,result){assert.ok(result,name);checks.push(name);}
async function login(page,account){
  await page.goto(base);
  await page.locator('#login').click();
  await page.locator('#login-form input[name=id]').fill(account.id);
  await page.locator('#login-form input[name=password]').fill(account.password);
  await page.locator('#login-form button').click();
  await page.waitForFunction(()=>document.querySelector('#login')?.textContent?.includes('退出'));
}
const form=page=>page.locator('#fin-impact-form');
async function field(page,name,value){await form(page).locator('input[name="'+name+'"]').fill(value);}
async function preview(page){
  const wait=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/preview')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Preview Change'}).click();
  const response=await wait;assert.equal(response.status(),200,await response.text());
  const result=await response.json();assert.equal(result.saveBlocked,false);
  await page.getByText('Preview ready.',{exact:false}).waitFor();
  return result;
}
async function save(page,preview,heading='Development by period'){
  const wait=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/finance/versions/'));
  await page.getByRole('button',{name:'Save Draft'}).click();
  const response=await wait;assert.equal(response.status(),200,await response.text());
  const saved=await response.json();
  check('Web save reproduces preview digest',saved.calculationSha256===preview.calculationSha256);
  await page.getByRole('heading',{name:heading,exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#fin-impact-status')?.textContent);
  return saved;
}
const sourceLink=(page,name)=>page.getByRole('link',{name,exact:true}).first();
async function openSampleBatch(page,name){
  await sourceLink(page,name).click();
  await page.getByRole('region',{name:'Prototype period cost records'}).getByRole('link',{name,exact:true}).click();
}
async function openTestPackage(page,name){
  await sourceLink(page,name).click();
  await page.getByRole('region',{name:'Validation period cost records'}).getByRole('link',{name,exact:true}).click();
}
async function discardBack(page){
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('.fin-back').click();
}
function amounts(result,index,key){
  const row=result.comparison.periodic[index][key];
  return [row.before.displayValue,row.after.displayValue,row.delta.displayValue];
}
function t4(name,payload,value){
  const total=Number(value),d=(n)=>n.toFixed(2);
  const result={gross:amounts(payload,1,'development_gross'),developmentBudget:amounts(payload,1,'development_budget'),
    remaining:amounts(payload,1,'development_remaining'),engineering:amounts(payload,1,'net_engineering'),
    developmentCash:amounts(payload,1,'development_cash'),projectCash:amounts(payload,1,'cash_flow'),npvDelta:payload.comparison.metrics.npv.delta.displayValue};
  assert.deepEqual(result.gross,['5000.00',d(5000+total),d(total)]);
  assert.deepEqual(result.developmentBudget,['10000.00','10000.00','0.00']);
  assert.deepEqual(result.remaining,['5000.00',d(5000-total),d(-total)]);
  assert.deepEqual(result.engineering,result.gross);
  assert.deepEqual(result.developmentCash,['-5000.00',d(-5000-total),d(-total)]);
  assert.deepEqual(result.projectCash,['105000.00',d(105000-total),d(-total)]);
  assert.equal(result.npvDelta,d(-total/1.1));
  check(name+' reconciles T4 year, budget, expense, cash and NPV',payload.affectedPeriods.includes('year-1')&&
    !payload.affectedPeriods.includes('year-0')&&amounts(payload,2,'cash_flow')[2]==='0.00');
  reconciliation[name]=result;
}

try{
  const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),page=await desktop.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await login(page,accounts.admin);
  await page.locator('.finance-project-entry[href="'+root+'"]').click();
  await page.locator('#fin-filter-product').selectOption('product-a');
  await page.locator('#fin-filter-period').selectOption('year-1');
  const dashboard=page.url();
  await page.locator('#module-prototypes').click();
  const sampleQuote=page.getByRole('region',{name:'Prototype quote packages'}).getByRole('row',{name:/T4 Sample Batch/});
  await sampleQuote.getByText('0.00',{exact:true}).waitFor();
  check('A fully covered sample batch shows an explicit zero independent forecast',true);
  await openSampleBatch(page,'T4 Sample Batch');
  const prototypeKey=new URL(page.url()).pathname.split('/').at(-1);
  const sample=page.locator('#fin-development-source');
  await sample.getByText('4 / 4',{exact:true}).waitFor();
  check('Main-site prototype source shows four included samples',(await sample.innerText()).includes('Covered by DV Package (4)'));
  await page.screenshot({path:join(evidence,'desktop-prototype.png')});
  await page.locator('#fin-development-edit').click();
  await field(page,'quantity','10');
  t4('samplesOnly',await preview(page),1800);
  await discardBack(page);
  await sample.getByRole('link',{name:'DV Package'}).click();
  const packageKey=new URL(page.url()).pathname.split('/').at(-1);
  check('Cross-link opens validation package source with its included batch',
    (await sample.innerText()).includes('Package includes T4 Sample Batch (4)'));
  await page.screenshot({path:join(evidence,'desktop-validation.png')});
  await page.locator('#module-validation').click();
  await openTestPackage(page,'T4 Retest');
  const retestKey=new URL(page.url()).pathname.split('/').at(-1);
  await page.locator('#fin-development-edit').click();
  await field(page,'quantity','1');
  t4('retestOnly',await preview(page),2000);
  await discardBack(page);
  await page.locator('#module-validation').click();
  await page.locator('#fin-validation-records').click();
  await page.locator('#fin-filter-period').selectOption('year-1');
  await page.locator('#fin-development-combine').click();
  await field(page,'change:'+prototypeKey,'10');
  await field(page,'change:'+retestKey,'1');
  const combined=await preview(page);
  t4('combined',combined,3800);
  check('Combined preview includes both source keys and a trace to NPV',combined.fields.length===2&&combined.paths.every(path=>path.nodes.some(node=>node.metricKey==='npv')));
  await page.getByRole('heading',{name:'Development period impact'}).evaluate(node=>node.scrollIntoView({block:'start'}));
  await page.screenshot({path:join(evidence,'desktop-t4-impact.png')});
  await save(page,combined);
  await page.reload();
  const summary=page.getByRole('row',{name:/2027.*10,?000/}).first();
  const net=page.getByRole('heading',{name:'Development by period',exact:true})
    .locator('xpath=following-sibling::div[contains(@class,"fin-dev-table")][1]');
  await net.getByText('1200.00 CNY',{exact:true}).waitFor();
  check('Saved combined forecast displays the 10,000 ceiling and 1,200 remaining',
    (await net.innerText()).includes('10000.00 CNY')&&(await net.innerText()).includes('8800.00 CNY'));
  check('2027 row is visible after a direct reload',await summary.count()>0);
  await page.goto(dashboard);await page.locator('#module-validation').click();await openTestPackage(page,'DV Package');
  await page.locator('.fin-back').click();await page.getByRole('region',{name:'Validation period cost records'}).waitFor();
  await page.locator('.fin-back').click();await sourceLink(page,'DV Package').waitFor();
  await page.locator('.fin-back').click();await page.locator('#module-validation').waitFor();
  check('Explicit source and module returns restore the dashboard URL',page.url()===dashboard);
  await page.locator('#metric-npv').click();
  await page.getByRole('heading',{name:'Period Cash Flow',exact:true}).waitFor();
  check('Project Returns shows persisted Year 1 cash after combined expense',(await page.locator('#finance-workspace').innerText()).includes('101,200.00 CNY'));
  await page.locator('.fin-back').click();await page.locator('#module-engineering').click();
  await page.locator('#fin-filter-period').selectOption('year-0');
  await sourceLink(page,'PM Planning Hours').click();
  await page.getByRole('region',{name:'Work package period records'}).getByRole('link').first().click();
  await sample.waitFor();
  check('Engineering source traces role, phase, hours, travel and amount',(await sample.innerText()).includes('Project Manager')&&
    (await sample.innerText()).includes('Additional travel total 25 CNY')&&(await sample.innerText()).includes('525.00 CNY'));
  await page.screenshot({path:join(evidence,'desktop-engineering.png')});
  await page.locator('#fin-filter-version').selectOption(run.executionDraft);
  await page.locator('#module-engineering').click();
  await page.locator('#fin-eng-records').click();
  await page.locator('#fin-filter-period').selectOption('year-0');
  await page.locator('#fin-development-new').click();
  for(const [key,value] of Object.entries({costRef:'NEW-ROLE-PLAN',title:'New design review hours',group:'Concept review',role:'Design Engineer',quantity:'2',
    'component:rate':'100',reference:'Synthetic approved hour estimate',allocationBasis:'Dedicated product'}))await field(page,key,value);
  const engineering=await preview(page);
  check('Engineering entry accepts new role, phase, hours and rate',amounts(engineering,0,'development_gross')[2]==='200.00');
  await save(page,engineering,'New design review hours');
  await page.locator('#fin-development-source').getByRole('heading',{name:'New design review hours'}).waitFor();
  await desktop.close();

  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),phone=await mobile.newPage();
  phone.on('pageerror',error=>errors.push(error.message));
  await login(phone,accounts.quality);
  await phone.locator('.finance-nav-entry').click();
  if(new URL(phone.url()).pathname==='/finance'&&await phone.locator('#project-'+run.synthetic).count())await phone.locator('#project-'+run.synthetic).click();
  await phone.locator('#fin-filter-version').selectOption(run.executionDraft);
  await phone.locator('#module-validation').click();
  await openTestPackage(phone,'T4 Retest');
  check('Mobile source is within the viewport',await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await phone.locator('#fin-development-actual').click();
  await field(phone,'incurred-amount','2000');
  await field(phone,'incurred-date','2027-12-03');
  await field(phone,'incurred-reference','Synthetic quality acceptance Q-17');
  await field(phone,'payment-amount','2000');
  await form(phone).locator('[name=payment-period]').selectOption('year-2');
  await field(phone,'payment-date','2028-01-05');
  await field(phone,'payment-reference','Synthetic payment P-17');
  const actual=await preview(phone);
  check('Quality occurrence is 2,000 in 2027 and payment moves from 2027 to 2028',
    amounts(actual,1,'development_actual')[2]==='2000.00'&&amounts(actual,1,'development_cash')[2]==='2000.00'&&
    amounts(actual,2,'development_cash')[2]==='-2000.00'&&amounts(actual,1,'net_engineering')[2]==='0.00');
  await phone.getByRole('heading',{name:'Development period impact'}).evaluate(node=>node.scrollIntoView({block:'start'}));
  await phone.screenshot({path:join(evidence,'mobile-actual-timing.png')});
  await save(phone,actual,'T4 Retest');
  await phone.reload();await phone.locator('#fin-development-source').getByText('Synthetic payment P-17',{exact:true}).waitFor();
  await phone.getByRole('link',{name:'Prototype Batches',exact:true}).click();
  await openSampleBatch(phone,'T4 Sample Batch');
  check('Quality can read but cannot change the prototype source',await phone.locator('#fin-development-actual,#fin-development-edit').count()===0);
  await mobile.close();

  const archive=await browser.newContext({viewport:{width:1440,height:1000}}),arch=await archive.newPage();
  await login(arch,accounts.reader);
  await arch.locator('.finance-project-entry[href="/projects/'+run.projectId+'/finance"]').click();
  await arch.locator('#module-validation').click();
  await arch.locator('#fin-validation-records').click();
  const source=arch.locator('.fin-dev-archive');
  await source.getByText('Covered by DV',{exact:true}).first().waitFor();
  check('Real CQA shows archived DV/PV references and PV overlap with read-only access',
    (await source.innerText()).includes('PV cost!Y9')&&(await source.innerText()).includes('DV cost!AE9')&&
    await arch.locator('#fin-development-new').count()===0);
  await arch.screenshot({path:join(privateDir,'cqa-validation.png')});
  await archive.close();
  check('No uncaught script errors',errors.length===0);
  await writeFile(join(evidence,'browser-checks.json'),JSON.stringify({step:'P10',browser:'Chrome',viewports:[[1440,1000],[390,844]],checks,reconciliation},null,2)+'\n');
} finally {await browser.close();}
