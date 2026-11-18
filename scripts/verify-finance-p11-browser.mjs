import {financeReviewConfig} from './finance-review-config.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const {base,run,evidence}=await financeReviewConfig('p11',18751);
const accounts=JSON.parse(await readFile(run.credentials,'utf8'));
const privateDir=join(run.directory,'browser');
await mkdir(evidence,{recursive:true});await mkdir(privateDir,{recursive:true});
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-proxy-server']});
const checks=[],reconciliation={};
const root='/projects/'+run.synthetic+'/finance';
function check(name,condition){assert.ok(condition,name);checks.push(name);}
async function login(page,account){
  await page.goto(base);
  await page.locator('#login').click();
  await page.locator('#login-form input[name=id]').fill(account.id);
  await page.locator('#login-form input[name=password]').fill(account.password);
  await page.locator('#login-form button').click();
  await page.waitForFunction(()=>document.querySelector('#login')?.textContent?.includes('退出'));
}
const form=page=>page.locator('#fin-impact-form');
async function preview(page){
  const wait=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/preview')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Preview Change'}).click();
  const response=await wait;assert.equal(response.status(),200,await response.text());
  const result=await response.json();assert.equal(result.saveBlocked,false);
  await page.getByText('Preview ready.',{exact:false}).waitFor();
  return result;
}
async function save(page,preview){
  const wait=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/finance/versions/'));
  await page.getByRole('button',{name:'Save Draft'}).click();
  const response=await wait;assert.equal(response.status(),200,await response.text());
  const saved=await response.json();
  check('Saved result exactly matches preview digest',saved.calculationSha256===preview.calculationSha256);
  await page.locator('#fin-capital-source').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#fin-impact-status')?.textContent);
}
const source=page=>page.locator('#fin-capital-source');
const events=page=>page.locator('#fin-funding-events');
const payment=page=>events(page).getByRole('link',{name:'T5 Assembly Equipment · PO-T5-DEPOSIT',exact:true});
const recovery=page=>events(page).getByRole('link',{name:'T5 Customer Compensation · Forecast balance',exact:true});
const toReturn=page=>page.locator('#fin-capital-returns').click();
const level=(result,key)=>result.comparison.metrics[key];
const money=(record)=>[record.before.displayValue,record.after.displayValue,record.delta.displayValue];
function comparison(result){
  return {
    capital:money(level(result,'capital_gross')),payments:money(level(result,'capital_payments')),received:money(level(result,'capital_receipts')),
    contract:money(level(result,'capital_agreed')),netCapital:money(level(result,'capital_net')),npv:money(level(result,'npv')),
    peak:money(level(result,'peak_funding_requirement')),profit:money(level(result,'operating_profit')),cbt:money(level(result,'incremental_profit')),
    cashDelta:result.comparison.periodic.map(row=>row.cash_flow.delta.displayValue),
    firstMinimum:[level(result,'peak_funding_requirement').before.details.firstPeriod,level(result,'peak_funding_requirement').after.details.firstPeriod],
    payback:[level(result,'payback_period').before.displayValue,level(result,'payback_period').after.displayValue,
      level(result,'payback_period').after.status]
  };
}

try{
  const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),page=await desktop.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await login(page,accounts.admin);
  await page.locator('.finance-project-entry[href="'+root+'"]').click();
  await page.locator('#fin-filter-product').selectOption('product-a');
  await page.locator('#fin-filter-period').selectOption('year-1');
  await page.locator('#metric-npv').click();
  await events(page).waitFor();
  const returns=page.url(),id=await payment(page).getAttribute('id');
  check('Homepage NPV reaches a Year 0 cash low and Year 1 recovery',
    (await events(page).innerText()).includes('First minimum · Year 0 · First recovery 2027'));
  await payment(page).click();
  await source(page).getByRole('heading',{name:'T5 Assembly Equipment',exact:true}).waitFor();
  check('Funding event opens ME and procurement evidence plus payment schedule',
    (await source(page).innerText()).includes('Synthetic PO T5-01')&&(await source(page).innerText()).includes('Synthetic ME specification')&&
    (await source(page).innerText()).includes('Synthetic capital payment T5-01'));
  await source(page).scrollIntoViewIfNeeded();
  await page.screenshot({path:join(evidence,'desktop-asset-source.png')});
  await page.locator('.fin-back').click();
  await payment(page).waitFor();
  await page.waitForFunction(key=>document.activeElement?.id===key,id);
  check('Asset back link restores returns filters and funding row focus',page.url()===returns);
  await recovery(page).click();
  await source(page).getByRole('heading',{name:'T5 Customer Compensation',exact:true}).waitFor();
  check('Settlement link opens the single linked agreement and receivable',
    (await source(page).innerText()).includes('Synthetic customer contract T5-C')&&(await source(page).innerText()).includes('Synthetic receivable T5-AR'));
  await page.locator('#fin-edit-recovery').click();
  await form(page).locator('[name=receipt-period]').selectOption('year-2');
  const delayed=await preview(page),d=comparison(delayed);
  assert.deepEqual(d.npv,['-909.09','-1735.54','-826.45']);
  assert.deepEqual(d.cashDelta,['0.00','-10000.00','10000.00']);
  assert.deepEqual(d.peak,['10000.00','10000.00','0.00']);
  assert.deepEqual(d.firstMinimum,['year-0','year-0']);
  assert.deepEqual(d.payback,['1.00','2.00','ok']);
  check('Receipt delay changes NPV and liquidity duration with zero lifetime investment, contract, recovery, and profit changes',
    [d.capital,d.payments,d.received,d.contract,d.netCapital,d.profit,d.cbt].every(row=>row[2]==='0.00'));
  check('Receipt change connects to cash, NPV and funding impact',delayed.paths.some(path=>
    ['capital_receipts','cash_flow','npv','peak_funding_requirement'].every(metric=>path.nodes.some(node=>node.metricKey===metric))));
  reconciliation.receiptTiming=d;
  await page.getByRole('heading',{name:'Capital & cash by period'}).evaluate(node=>node.scrollIntoView({block:'start'}));
  await page.screenshot({path:join(evidence,'desktop-t5-receipt.png')});
  await save(page,delayed);
  await page.reload();
  await source(page).getByText('2028',{exact:true}).waitFor();
  await toReturn(page);
  check('Reloaded agreement retains the delayed receipt and the same Year 0 low',
    (await events(page).innerText()).includes('First minimum · Year 0 · First recovery 2028'));
  await events(page).scrollIntoViewIfNeeded();
  await page.screenshot({path:join(evidence,'desktop-returns-funding.png')});

  await page.locator('#fin-filter-version').selectOption(run.amountDraft);
  await payment(page).click();
  await page.locator('#fin-edit-asset').click();
  await form(page).locator('input[name=gross]').fill('12000');
  const more=await preview(page),m=comparison(more);
  assert.deepEqual(m.npv,['-909.09','-2909.09','-2000.00']);
  assert.deepEqual(m.capital,['10000.00','12000.00','2000.00']);
  assert.deepEqual(m.peak,['10000.00','12000.00','2000.00']);
  assert.deepEqual(m.profit,['-10000.00','-12000.00','-2000.00']);
  assert.deepEqual(m.cashDelta,['-2000.00','0.00','0.00']);
  check('Independent asset increase keeps customer contract and receipt fixed and increases funding need',m.contract[2]==='0.00'&&m.received[2]==='0.00'&&
    m.netCapital[2]==='2000.00'&&m.payback[2]==='not_recovered');
  reconciliation.purchaseAmount=m;
  await page.getByRole('heading',{name:'Capital & cash by period'}).evaluate(node=>node.scrollIntoView({block:'start'}));
  await page.screenshot({path:join(evidence,'desktop-t5-investment.png')});
  await save(page,more);
  await toReturn(page);
  await page.locator('#fin-basis-full').click();
  await page.getByRole('heading',{name:'Full-cost profitability',exact:true}).waitFor();
  check('Full-cost basis shows depreciation independently of incremental cash',
    (await page.locator('#finance-workspace').innerText()).includes('Full-cost depreciation')&&await events(page).count()===0);
  await page.locator('#fin-basis-incremental').click();
  await events(page).waitFor();
  await page.locator('#fin-filter-version').selectOption(run.termsDraft);
  await page.locator('#fin-new-terms').click();
  for(const [name,value] of Object.entries({'receivable-days':'36','payable-days':'36','inventory-days':'18',tax:'0.2',reference:'Synthetic signed working-capital terms'}))
    await form(page).locator('input[name="'+name+'"]').fill(value);
  const terms=await preview(page),year=terms.comparison.periodic[1];
  check('Operating terms preview ties 16,000 of working capital and 22,000 of cash tax to 2027 cash',
    year.nwc.after.displayValue==='16000.00'&&year.nwc_change.delta.displayValue==='-16000.00'&&
    year.signed_tax.delta.displayValue==='-22000.00'&&year.cash_flow.after.displayValue==='72000.00');
  await page.getByRole('heading',{name:'Capital & cash by period'}).evaluate(node=>node.scrollIntoView({block:'start'}));
  await page.screenshot({path:join(evidence,'desktop-working-capital.png')});
  await save(page,terms);
  await page.reload();await source(page).getByRole('heading',{name:'Synthetic signed working-capital terms',exact:true}).waitFor();
  await page.locator('#fin-returns-investment').click();
  await page.locator('#fin-new-asset').click();
  await form(page).locator('[name=mode]').selectOption('existing_shared');
  for(const [name,value] of Object.entries({'asset-id':'SHARED-P11-REVIEW',title:'Shared Equipment Review',gross:'1000',me:'Shared ME scope',
    purchase:'Existing asset register',basis:'25% of machine time',life:'1','share:product-a':'0.25'}))
    await form(page).locator('input[name="'+name+'"]').fill(value);
  const shared=await preview(page);
  check('Existing shared asset editor preserves incremental profit and acquisition cash',
    level(shared,'capital_allocated').delta.displayValue==='250.00'&&level(shared,'operating_profit').delta.displayValue==='-250.00'&&
    level(shared,'incremental_profit').delta.displayValue==='0.00'&&level(shared,'capital_payments').delta.displayValue==='0.00');
  await save(page,shared);
  await desktop.close();

  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),phone=await mobile.newPage();
  phone.on('pageerror',error=>errors.push(error.message));
  await login(phone,accounts.admin);
  await phone.locator('.finance-nav-entry').click();
  await phone.locator('#project-'+run.synthetic).click();
  await phone.locator('#metric-npv').click();
  await recovery(phone).click();
  await source(phone).getByText('2028',{exact:true}).waitFor();
  await source(phone).scrollIntoViewIfNeeded();
  check('Narrow-screen home navigation can open the saved 2028 settlement',await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await phone.screenshot({path:join(evidence,'mobile-agreement.png')});
  await phone.locator('.fin-back').click();
  await events(phone).waitFor();
  await mobile.close();

  const archive=await browser.newContext({viewport:{width:1440,height:1000}}),arch=await archive.newPage();
  await login(arch,accounts.reader);
  await arch.locator('.finance-project-entry[href="/projects/'+run.projectId+'/finance"]').click();
  await arch.locator('#metric-npv').click();
  await arch.locator('#fin-filter-product').selectOption('double_buckle');
  await arch.getByText('P05 working capital, tax and discount sources',{exact:true}).click();
  check('CQA returns shows original inventory, receivable, payable and tax sources',
    (await arch.locator('.fin-capital-archive').innerText()).includes('D446')&&
    (await arch.locator('.fin-capital-archive').innerText()).includes('D448')&&
    (await arch.locator('.fin-capital-archive').innerText()).includes('C329'));
  await arch.locator('#fin-returns-investment').click();
  await arch.getByText('P05 asset payments and compensation',{exact:true}).click();
  check('CQA archive displays real investment sources and read-only action scope',
    (await arch.locator('.fin-capital-archive').innerText()).includes('Financials Dbl BK+SW')&&await arch.locator('#fin-new-asset').count()===0);
  await arch.screenshot({path:join(privateDir,'cqa-capital.png')});
  await archive.close();
  check('No uncaught page errors',errors.length===0);
  await writeFile(join(evidence,'browser-checks.json'),JSON.stringify({step:'P11',browser:'Chrome',viewports:[[1440,1000],[390,844]],checks,reconciliation},null,2)+'\n');
} finally {await browser.close();}
