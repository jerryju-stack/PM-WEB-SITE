import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';

const config=process.env.FINANCE_REVIEW_CASE??'.deploy/finance-workbench-review/latest-run.json';
const run=JSON.parse(await readFile(config,'utf8'));
const account=JSON.parse(await readFile(run.credentials,'utf8'));
const evidence=process.env.FINANCE_REVIEW_EVIDENCE??join(run.directory,'acceptance');
const base='http://127.0.0.1:'+run.port;
const project='/projects/'+run.project+'/finance';
const theme=process.env.FINANCE_REVIEW_THEME??'dark';
assert(['light','dark'].includes(theme));
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args:['--no-proxy-server']});
const pages=[
  ['','Project Finance Dashboard'],['commercial','Volume and selling price by year'],['bom','BOM quotes and landed cost'],
  ['operations','Operations and direct labor'],['factory-costs','Factory cost and launch by period'],
  ['engineering','Engineering work packages'],['prototypes','Sample quotes and delivery'],['validation','Validation by specification and stage'],
  ['investment','Equipment, Tooling & Compensation'],['returns','Incremental project returns'],['budget','Budget status by period']
];
const results=[];
try{
  await mkdir(evidence,{recursive:true});
  for(const [device,width,height] of [['desktop',1440,960],['mobile',390,844]]){
    const context=await browser.newContext({viewport:{width,height},hasTouch:device==='mobile',colorScheme:theme});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const waitHeading=heading=>page.getByRole('heading',{name:heading,exact:true}).waitFor();
    async function screenshot(name){
      if(name==='mobile-equipment')await page.getByRole('heading',{name:'Equipment and tooling register'}).evaluate(node=>
        node.scrollIntoView({block:'start'}));
      else await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:join(evidence,name+'.png')});
    }
    await page.goto(base);
    await page.locator('#login').click();
    await page.locator('#login-form input[name=id]').fill(account.id);
    await page.locator('#login-form input[name=password]').fill(account.password);
    await page.locator('#login-form button').click();
    await page.locator('#login-form').waitFor({state:'detached'});
    await page.locator('.finance-nav-entry').click();
    await page.waitForFunction(path=>location.pathname===path||document.querySelector('.fin-projects'),project);
    if(new URL(page.url()).pathname!==project)await page.locator('#project-'+run.project).click();
    await waitHeading('Project Finance Dashboard');
    for(const [section,heading] of pages){
      if(section)await page.locator('#module-'+section).click();
      await waitHeading(heading);
      assert.equal(await page.locator('.fin-sections [aria-current=page]').count(),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,device+' overflow in '+section);
      assert.equal(await page.locator('.fin-sections').evaluate(node=>getComputedStyle(node).backgroundColor),
        theme==='light'?'rgb(255, 255, 255)':'rgb(29, 30, 35)');
      if(device==='desktop'&&section==='')await screenshot('desktop-dashboard');
      if(device==='desktop'&&section==='commercial')await screenshot('desktop-commercial');
      results.push({device,section:section||'dashboard',verified:true});
    }
    await page.locator('#module-investment').click();
    await page.locator('#fin-equipment-items').click();
    await waitHeading('Equipment & Tooling Details');
    assert.equal(await page.locator('tbody tr').count(),20);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    if(device==='desktop')await screenshot('desktop-equipment');
    if(device==='mobile')await screenshot('mobile-equipment');
    await page.locator('tbody a').first().click();
    await page.locator('#fin-capital-source').waitFor();
    assert.match(await page.locator('#fin-capital-source').innerText(),/3250000\.00 CNY/);
    await page.locator('.fin-back').click();
    await page.locator('#fin-asset-search').waitFor();
    results.push({device,section:'equipment-list-and-card',verified:true});
    await page.locator('#fin-dashboard').click();
    await waitHeading('Project Finance Dashboard');
    const settings=page.locator('#fin-more-settings');
    assert.equal(await settings.evaluate(el=>el.open),false);
    await page.keyboard.press('Tab');
    await settings.locator('summary').first().focus();
    assert.equal(await settings.locator('summary').first().evaluate(el=>el.matches(':focus-visible')),true);
    await page.keyboard.press('Enter');
    await page.locator('#fin-display-currency').waitFor();
    for(const currency of ['USD','EUR','CNY']){
      await page.locator('#fin-display-currency').selectOption(currency);
      await page.waitForFunction(code=>document.querySelector('#metric-npv')?.closest('.fin-metric')?.textContent?.includes(code),currency);
    }
    await page.locator('#fin-filter-version').selectOption(run.cash);
    await page.getByText(/Cash-flow reconciliation version/).waitFor();
    assert.equal(await page.locator('.fin-overview-metrics .fin-metric').count(),2);
    assert.deepEqual(errors,[]);
    results.push({device,section:'settings-fx-and-cash-only',verified:true});
    await context.close();
  }
  await writeFile(join(evidence,'browser-checks.json'),JSON.stringify({version:run.version,results},null,2)+'\n');
  console.log('Finance workbench verified '+results.length+' desktop/mobile page and workflow checks');
}finally{await browser.close();}
