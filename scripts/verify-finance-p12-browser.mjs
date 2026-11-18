import {financeReviewConfig} from './finance-review-config.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const {base,run,evidence}=await financeReviewConfig('p12',18752);
const accounts=JSON.parse(await readFile(run.credentials,'utf8'));
const checks=[];
await mkdir(evidence,{recursive:true});
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-proxy-server']});
const finance='/projects/'+run.project+'/finance',api='/api'+finance+'/versions/'+run.workflow,scopeURL=base+finance+'/budget/'+run.scope+'?version='+run.workflow;
const form=page=>page.locator('#fin-impact-form');
const budget=page=>page.locator('#fin-budget-source');
const posting=page=>page.locator('#fin-budget-posting');
const status=page=>page.locator('#fin-impact-status');
const record=(page,title)=>budget(page).getByRole('link',{name:title,exact:true}).first();
const metricKeys=['approved_budget','confirmed_actual','draft_cost','etc','eac','budget_balance','completion_variance'];
const fields=(values)=>Object.fromEntries(metricKeys.map((key,i)=>[key,values[i]]));
const T6=fields(['1000.00','400.00','50.00','500.00','900.00','600.00','100.00']);
const accepted=fields(['1000.00','450.00','0.00','450.00','900.00','550.00','100.00']);
const corrected=fields(['1000.00','430.00','0.00','450.00','880.00','570.00','120.00']);
const overrun=fields(['1000.00','430.00','0.00','700.00','1130.00','570.00','-130.00']);
function check(name,condition){assert.ok(condition,name);checks.push(name);}

async function login(page,account){
  await page.goto(base);
  await page.locator('#login').click();
  await page.locator('#login-form input[name=id]').fill(account.id);
  await page.locator('#login-form input[name=password]').fill(account.password);
  await page.locator('#login-form button').click();
  await page.waitForFunction(()=>document.querySelector('#login')?.textContent?.includes('退出'));
}
async function openFromHome(page,project=run.project){
  await page.locator('.finance-nav-entry').click();
  await page.waitForFunction(id=>location.pathname==='/projects/'+id+'/finance'||!!document.getElementById('project-'+id),project);
  if(new URL(page.url()).pathname==='/finance')await page.locator('#project-'+project).click();
  await page.getByRole('link',{name:'Open budget',exact:true}).click();
  await page.getByRole('heading',{name:'Budget Policy & Cost Scopes',exact:true}).waitFor();
}
async function openScope(page){
  await page.getByRole('link',{name:'T6 Engineering Services',exact:true}).click();
  await budget(page).waitFor();
}
async function formFill(page,values){
  for(const [name,value] of Object.entries(values))await form(page).locator('input[name="'+name+'"]').fill(value);
}
async function preview(page){
  const wait=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/preview')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Preview Change',exact:true}).click();
  const response=await wait;assert.equal(response.status(),200,await response.text());
  const result=await response.json();assert.equal(result.saveBlocked,false);
  await page.getByText('Preview ready.',{exact:false}).waitFor();
  return result;
}
async function save(page,preview,expected=200){
  const wait=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/finance/versions/'));
  await page.locator('#fin-save').click();
  const response=await wait;assert.equal(response.status(),expected,await response.text());
  const result=await response.json();
  if(expected===200){
    check('Saved budget action matches the preview digest',result.calculationSha256===preview.calculationSha256);
    await page.waitForFunction(()=>!document.querySelector('#fin-impact-status')?.textContent&&!!document.querySelector('#finance-workspace'));
  }
  return result;
}
async function values(page,expected){
  for(const [key,amount] of Object.entries(expected)){
    const expectedText=Number(amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' CNY';
    await budget(page).locator('dd[data-budget-metric="'+key+'"]').getByText(expectedText,{exact:true}).waitFor();
  }
}
const candidate=(result,expected)=>Object.entries(expected).every(([key,value])=>result.comparison.budget[key].after.displayValue===value);
const zeroOperations=result=>['operating_profit','npv'].every(key=>result.comparison.metrics[key].delta.displayValue==='0.00')&&
  result.comparison.periodic.every(row=>row.cash_flow.delta.displayValue==='0.00');
async function chooseWorkflow(page){
  await page.locator('#fin-filter-version').selectOption(run.workflow);
  await page.waitForURL('**version='+run.workflow+'**');
  await page.getByRole('heading',{name:'Budget Policy & Cost Scopes',exact:true}).waitFor();
}
const approvalInput=(version,key=run.draft)=>({requestKey:'p12-browser-self-test',reason:'Synthetic self-review control',revision:version.revision,
  effectivePeriod:{from:'year-0',to:'year-2'},changeSet:[{collection:'budget_execution',action:'confirm',key,record:{reference:'Synthetic self approval'}}]});

try{
  const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),maker=await desktop.newPage(),errors=[];
  maker.on('pageerror',error=>errors.push(error.message));
  await login(maker,accounts.maker);
  await openFromHome(maker);
  await openScope(maker);
  await values(maker,T6);
  check('T6 displays separate 400 actual, 50 draft, 500 ETC and 900 EAC',true);
  await budget(maker).scrollIntoViewIfNeeded();
  await maker.screenshot({path:join(evidence,'desktop-t6.png')});
  await chooseWorkflow(maker);
  await openScope(maker);
  await record(maker,'T6 Follow-up Service').click();
  await posting(maker).getByText('An independent approver must confirm this draft.',{exact:true}).waitFor();
  const current=await (await maker.request.get(base+api)).json();
  check('A preparer with approval capabilities cannot confirm their own posting',
    await maker.locator('#fin-budget-confirm').count()===0&&
    (await maker.request.post(base+api+'/preview',{data:approvalInput(current)})).status()===403);

  const reviewerContext=await browser.newContext({viewport:{width:1440,height:1000}}),reviewer=await reviewerContext.newPage();
  reviewer.on('pageerror',error=>errors.push(error.message));
  await login(reviewer,accounts.reviewer);
  await openFromHome(reviewer);await chooseWorkflow(reviewer);await openScope(reviewer);
  await record(reviewer,'T6 Follow-up Service').click();
  await reviewer.locator('#fin-budget-confirm').click();
  await formFill(reviewer,{reference:'Synthetic approval for late service'});
  const early=await preview(reviewer);
  check('Independent approval consumes matching ETC with zero operating or cash impact',candidate(early,accepted)&&zeroOperations(early));
  await reviewer.getByRole('heading',{name:'Budget execution impact',exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));
  await reviewer.screenshot({path:join(evidence,'desktop-confirm-preview.png')});

  await maker.goto(scopeURL);
  await record(maker,'T6 Accepted Service').click();
  await maker.locator('#fin-budget-pay').click();
  await formFill(maker,{'document-id':'P12-PAID-125',title:'T6 Payment in 2028',date:'2028-02-01',amount:'125',reference:'Synthetic settlement voucher'});
  await form(maker).locator('[name=accounting-period]').selectOption('year-2');
  const pay=await preview(maker);
  check('A later payment updates settlements while T6 actual, EAC and operating cash remain unchanged',candidate(pay,T6)&&zeroOperations(pay)&&
    pay.comparison.budget.recorded_payments.after.displayValue==='125.00');
  await save(maker,pay);
  await posting(maker).getByRole('heading',{name:'T6 Payment in 2028',exact:true}).waitFor();
  await save(reviewer,early,409);
  await status(reviewer).getByText(/Finance revision conflict/).waitFor();
  check('Stale approval fails with a revision conflict after another posting',true);

  reviewer.once('dialog',dialog=>dialog.accept());
  await reviewer.reload();
  await formFill(reviewer,{reference:'Synthetic approval after reread'});
  const fresh=await preview(reviewer);
  const routeUrl=base+api;
  let dropped,firstSave;
  await reviewer.route(routeUrl,async route=>{
    if(route.request().method()!=='PUT'||dropped)return route.continue();
    dropped=route.request().postDataJSON();
    const committed=await route.fetch();
    assert.equal(committed.status(),200);
    firstSave=await committed.json();
    await route.abort('failed');
  });
  await reviewer.locator('#fin-save').click();
  await status(reviewer).getByText(/Failed to fetch|NetworkError/).waitFor();
  const retry=await save(reviewer,fresh);
  assert.deepEqual(retry,firstSave);
  await reviewer.unroute(routeUrl);
  check('Retry after a lost confirmation response returns the original receipt',retry.changeSetId===firstSave.changeSetId);
  await reviewer.reload();
  await values(reviewer,accepted);
  await posting(reviewer).getByText('Independent Approver',{exact:true}).waitFor();

  await maker.goto(scopeURL);
  await record(maker,'T6 Accepted Service').click();
  await maker.locator('#fin-budget-adjust').click();
  await formFill(maker,{'document-id':'P12-ADJ-20',title:'T6 Credit in 2028',date:'2028-04-01',amount:'-20',reference:'Synthetic credit advice'});
  await form(maker).locator('[name=accounting-period]').selectOption('year-2');
  await save(maker,await preview(maker));
  await posting(maker).getByRole('heading',{name:'T6 Credit in 2028',exact:true}).waitFor();
  const correctionURL=maker.url();
  await reviewer.goto(correctionURL);
  await reviewer.locator('#fin-budget-confirm').click();
  await formFill(reviewer,{reference:'Synthetic independent credit approval'});
  const correction=await preview(reviewer);
  check('Cross-period correction adjusts actual in 2028 and retains the original cutoff ETC',candidate(correction,corrected)&&zeroOperations(correction));
  await save(reviewer,correction);
  await reviewer.reload();
  await values(reviewer,corrected);
  await posting(reviewer).getByRole('link',{name:'T6 Accepted Service',exact:true}).waitFor();
  await posting(reviewer).scrollIntoViewIfNeeded();
  await reviewer.screenshot({path:join(evidence,'desktop-cross-period-adjustment.png')});

  await maker.goto(scopeURL);
  await maker.locator('#fin-budget-etc').click();
  await formFill(maker,{amount:'700',reference:'Synthetic revised forecast at 2028 cutoff'});
  await form(maker).locator('[name=accounting-period]').selectOption('year-2');
  const excess=await preview(maker);
  check('Overrun exceeds EAC budget by 130 while actual-cost budget balance stays 570',candidate(excess,overrun));
  await save(maker,excess);
  await values(maker,overrun);
  await maker.locator('.fin-budget-overrun').first().scrollIntoViewIfNeeded();
  await maker.screenshot({path:join(evidence,'desktop-overrun.png')});
  await maker.locator('#fin-budget-dashboard').click();
  await maker.getByRole('link',{name:'Open budget',exact:true}).waitFor();
  check('Overrun source returns to the dashboard with the same forecast',new URL(maker.url()).pathname===finance&&
    new URL(maker.url()).searchParams.get('version')===run.workflow);

  const adminContext=await browser.newContext(),admin=await adminContext.newPage();
  await login(admin,accounts.admin);
  const members=base+'/api/projects/'+run.project+'/members';
  const groups=await (await admin.request.get(members)).json();
  const approvalGroup=groups.find(row=>row.userUid===run.reviewerUid).groupId;
  const grant=groupId=>admin.request.patch(members,{data:{userUid:run.reviewerUid,groupId}});
  try {
    assert.equal((await grant('finance-reader')).status(),200);
    check('Revoked approver cannot replay a prior receipt even with read access',
      (await reviewer.request.put(routeUrl,{data:dropped})).status()===403);
    await reviewer.goto(correctionURL);
    await posting(reviewer).getByText('Independent Approver',{exact:true}).waitFor();
    assert.equal(await reviewer.locator('#fin-budget-confirm').count(),0);
    assert.equal((await admin.request.delete(members,{data:{userUid:run.reviewerUid}})).status(),200);
    check('Removed membership also blocks a fresh version read',(await reviewer.request.get(routeUrl)).status()===404);
  }finally {assert.equal((await grant(approvalGroup)).status(),200);}
  await admin.goto(base);await openFromHome(admin,run.setupProject);
  await admin.locator('#fin-budget-policy').click();
  await form(admin).locator('[name=currency]').selectOption('JPY');
  await form(admin).locator('[name=tax]').selectOption('inclusive');
  await form(admin).locator('[name=recognition]').selectOption('invoice_review');
  await formFill(admin,{reference:'Synthetic enterprise accounting basis'});
  await save(admin,await preview(admin));
  await admin.locator('#fin-budget-policy-summary').getByText('JPY · 0 decimal places · Tax-inclusive · Invoice review',{exact:true}).waitFor();
  check('A separate project can establish a different currency precision, tax and recognition policy',true);

  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),phone=await mobile.newPage();
  phone.on('pageerror',error=>errors.push(error.message));
  await login(phone,accounts.maker);
  await openFromHome(phone);await openScope(phone);await values(phone,T6);
  await phone.getByRole('heading',{name:'T6 Engineering Services',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));
  check('Narrow-screen budget preserves T6 and stays within the viewport',await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await phone.screenshot({path:join(evidence,'mobile-t6.png')});
  check('No uncaught page errors',errors.length===0);
  await writeFile(join(evidence,'browser-checks.json'),JSON.stringify({step:'P12',browser:'Chrome',viewports:[[1440,1000],[390,844]],checks,
    reconciliation:{T6,accepted,corrected,overrun,recordedPayments:'125.00',projectOperatingImpact:'0.00'}},null,2)+'\n');
} finally {await browser.close();}
