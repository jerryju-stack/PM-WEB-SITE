import {financeReviewConfig} from './finance-review-config.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const {base,run,evidence}=await financeReviewConfig('p13',18753);
const accounts=JSON.parse(await readFile(run.credentials,'utf8'));
await mkdir(evidence,{recursive:true});
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-proxy-server']});
const checks=[],numbers={};
function check(name,condition){assert.ok(condition,name);checks.push(name);}
const project='/projects/'+run.synthetic+'/finance';
async function login(page,account){
  await page.goto(base);
  await page.locator('#login').click();
  await page.locator('#login-form input[name=id]').fill(account.id);
  await page.locator('#login-form input[name=password]').fill(account.password);
  await page.locator('#login-form button').click();
  await page.waitForFunction(()=>document.querySelector('#login')?.textContent?.includes('退出'));
}
const panel=(page,name)=>page.locator('.fin-panel').filter({has:page.getByRole('heading',{name,exact:true})});
const chart=page=>page.locator('.fin-compare-cash canvas');
const change=(page,metric)=>panel(page,'Version totals').getByRole('row',{name:new RegExp('\\b'+metric+'\\b','i')}).getByRole('cell').last();
async function next(page,name,choice){
  const el=page.locator('#fin-compare-'+name);
  await el.selectOption(choice);
  await page.waitForFunction(({name,choice})=>{
    const el=document.querySelector('#fin-compare-'+name);
    return el?.value===choice&&new URLSearchParams(location.search).get(name)===choice;
  },{name,choice});
}
async function preview(page,value){
  await page.locator('#fin-impact-form input[name=value]').fill(value);
  const watch=page.waitForResponse(result=>new URL(result.url()).pathname.endsWith('/preview')&&result.request().method()==='POST');
  await page.getByRole('button',{name:'Preview Change'}).click();
  const response=await watch;assert.equal(response.status(),200,await response.text());
  await page.getByText('Preview ready.',{exact:false}).waitFor();
  return response.json();
}

try{
  const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),page=await desktop.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await login(page,accounts.admin);
  await page.locator('.finance-project-entry[href="'+project+'"]').click();
  await page.locator('#dashboard-compare').waitFor();
  for(const id of ['commercial','bom','operations','factory-costs','engineering','prototypes','validation','investment','returns','budget'])
    check('Dashboard has direct entry for '+id,await page.locator('#module-'+id).isVisible());
  await page.locator('#dashboard-compare').click();
  await chart(page).waitFor();
  check('Dashboard opens the selected frozen version before the current draft',(await panel(page,'Version totals').innerText()).includes('SIMULATED · Current Forecast'));
  const originalURL=page.url();
  check('Unchanged draft displays zero profit and NPV changes',(await change(page,'NPV').innerText()).includes('0.00 CNY'));
  await page.locator('#fin-compare-cutoff').selectOption('year-0');
  await page.waitForFunction(()=>document.querySelector('#fin-compare-cutoff')?.value==='year-0'&&document.querySelector('.fin-compare-cash'));
  check('Year 0 cutoff solves using the supplied cash series',await panel(page,'Period values').locator('tbody tr').count()===1);
  await next(page,'cutoff','year-1');

  await page.getByRole('link',{name:'Dashboard',exact:true}).click();
  await page.locator('#metric-revenue').click();
  await page.getByRole('link',{name:'Selling price',exact:true}).click();
  const cancelled=await preview(page,'22');
  check('Single selling price preview shows +2,000 profit and +1,818.18 NPV',cancelled.comparison.metrics.operating_profit.delta.displayValue==='2000.00'&&
    cancelled.comparison.metrics.npv.delta.displayValue==='1818.18'&&cancelled.persisted===false);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('link',{name:'Version Comparison',exact:true}).click();
  await chart(page).waitFor();
  check('Discarding the candidate leaves saved comparison at zero',(await change(page,'NPV').innerText()).includes('0.00 CNY'));

  await page.getByRole('link',{name:'Dashboard',exact:true}).click();
  await page.locator('#metric-revenue').click();
  await page.getByRole('link',{name:'Selling price',exact:true}).click();
  const accepted=await preview(page,'22');
  const watchSave=page.waitForResponse(result=>result.request().method()==='PUT'&&result.url().includes('/finance/versions/'));
  await page.getByRole('button',{name:'Save Draft'}).click();
  const response=await watchSave;assert.equal(response.status(),200,await response.text());
  const receipt=await response.json();
  check('Saved revision matches the preview calculation digest',receipt.calculationSha256===accepted.calculationSha256);
  await page.getByRole('link',{name:'Version Comparison',exact:true}).click();
  await page.getByRole('heading',{name:'Operating Profit Bridge',exact:true}).waitFor();
  const profit=panel(page,'Operating Profit Bridge'),npv=panel(page,'NPV Bridge');
  await profit.locator('summary').filter({hasText:'Selling price / annual reduction'}).click();
  check('Profit bridge reports price contribution and exact reconciliation',
    (await profit.innerText()).includes('+2,000.00 CNY')&&(await profit.innerText()).includes('reconcile to the version change'));
  check('NPV reports compatible money with a separately recalculated IRR',(await npv.innerText()).includes('+1,818.18 CNY')&&
    (await change(page,'IRR').innerText()).includes('pp'));
  await profit.scrollIntoViewIfNeeded();
  await page.screenshot({path:join(evidence,'desktop-bridge.png')});
  const compareURL=page.url();
  const link=page.locator('#bridge-profit-sales_rate-0-after-0');
  await link.click();
  await page.getByRole('heading',{name:'Comparison source',exact:true}).waitFor();
  const details=panel(page,'Comparison source');
  check('Bridge link resolves the saved commercial row, revision and sales evidence',(await details.innerText()).includes('Sales quote EU-1')&&
    /22(?:\.0+)? CNY\/piece/.test(await details.innerText()));
  const sourceURL=page.url();
  await page.locator('.fin-back').click();
  await page.waitForFunction(()=>document.activeElement?.id==='bridge-profit-sales_rate-0-after-0');
  check('Explicit return restores exact comparison URL, expanded driver and link focus',page.url()===compareURL&&await link.isVisible());
  await page.goForward();
  await page.getByRole('heading',{name:'Comparison source',exact:true}).waitFor();
  check('Browser forward restores exact source URL',page.url()===sourceURL);
  await page.goto(compareURL);await chart(page).waitFor();
  check('Saved comparison is reproducible after full reopen',(await change(page,'NPV').innerText()).includes('+1,818.18 CNY'));
  numbers.syntheticGains={profit:'2000.00',npv:'1818.18',irrPointChange:await change(page,'IRR').innerText()};
  const from=new URL(compareURL).searchParams.get('from'),to=new URL(compareURL).searchParams.get('to');
  await next(page,'from',to);await next(page,'to',from);
  check('Reversing frozen and draft versions reverses the signed NPV change',(await change(page,'NPV').innerText()).includes('-1,818.18 CNY'));
  check('Desktop comparison has no page errors',errors.length===0);
  await desktop.close();

  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),reader=await mobile.newPage();
  await login(reader,accounts.reader);
  const archive='/projects/'+run.projectId+'/finance/compare?from='+run.baselineId+'&to='+run.archiveDraft;
  await reader.goto(base+archive);await chart(reader).waitFor();
  check('Read-only user loads the authorized CQA original and the labeled simulated revision',
    (await panel(reader,'Version totals').innerText()).includes('SIMULATED · CQA later-stage rehearsal'));
  const labor=panel(reader,'CQA MPBITRI Bridge');
  await labor.locator('summary').filter({hasText:'Manufacturing person-hours'}).click();
  check('One shared source contributes to two labeled products',await labor.locator('.fin-product-delta li').count()===2);
  const shared=labor.getByRole('link',{name:/After.*AME!F35/}).first();
  const target=await shared.getAttribute('href'),newTab=await mobile.newPage();
  const deepLink=await newTab.goto(base+target);assert.equal(deepLink?.status(),200);
  await newTab.getByRole('heading',{name:'Comparison source',exact:true}).waitFor();
  check('Fresh-tab source preserves AME cell and read-only access',(await panel(newTab,'Comparison source').innerText()).includes('AME!F35')&&
    await newTab.getByRole('button',{name:'Preview Change'}).count()===0);
  await newTab.getByRole('link',{name:'Back to Version Comparison'}).click();
  await chart(newTab).waitFor();
  check('Fresh-tab source reconstructs both CQA selections in its return link',new URL(newTab.url()).searchParams.get('to')===run.archiveDraft);
  await reader.goto(originalURL);
  await reader.getByRole('heading',{name:'Project unavailable'}).waitFor();
  check('Unassigned project stays unavailable for the CQA reader',await reader.getByRole('heading',{name:'Project unavailable'}).isVisible());
  await mobile.close();
  const narrow=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),small=await narrow.newPage();
  await login(small,accounts.admin);await small.goto(compareURL);await chart(small).waitFor();
  check('Narrow comparison has intrinsically scrollable tables without viewport overflow',await small.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await small.screenshot({path:join(evidence,'mobile-comparison.png')});
  await narrow.close();
  await writeFile(join(evidence,'browser-checks.json'),JSON.stringify({step:'P13',browser:'Chrome desktop and 390px',checks,numbers},null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,numbers}));
} finally {await browser.close();}
