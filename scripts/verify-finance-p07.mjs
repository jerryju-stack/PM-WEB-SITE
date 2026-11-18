import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';

const base=process.env.P07_BASE??'http://127.0.0.1:18747';
const run=JSON.parse(await readFile('.deploy/finance-p07/latest-run.json','utf8'));
const accounts=JSON.parse(await readFile(run.credentials,'utf8'));
const publicDir=resolve('docs/validation/project-finance/P07');
const privateDir=join(run.directory,'browser');
await mkdir(publicDir,{recursive:true});await mkdir(privateDir,{recursive:true});
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-proxy-server']});
const results=[],check=(device,name,passed)=>{assert(passed,device+' / '+name);results.push({device,check:name,status:'passed'});};
const dashboard=id=>'/projects/'+id+'/finance';

async function login(page,account) {
  await page.goto(base);
  await page.locator('#login').click();
  await page.locator('#login-form input[name=id]').fill(account.id);
  await page.locator('#login-form input[name=password]').fill(account.password);
  await page.locator('#login-form button').click();
  await page.locator('#login-form').waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelector('#login')?.textContent?.includes('退出'));
}

try {
  for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    const context=await browser.newContext({viewport,hasTouch:device==='mobile'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await login(page,accounts.admin);
    check(device,'normal website login and global finance entry',await page.locator('.finance-nav-entry').isVisible());
    await page.locator('.finance-nav-entry').click();
    await page.locator('#project-'+run.projectId).click();
    await page.locator('#metric-npv').waitFor();
    check(device,'six real metric cards',await page.locator('.fin-metric').count()===6);
    check(device,'approved P05 baseline selected',await page.locator('#fin-filter-baseline').inputValue()===run.baselineId);
    check(device,'frozen baseline does not appear as a current forecast',await page.locator('#fin-filter-version').inputValue()===''&&(await page.locator('.fin-context').innerText()).includes('Current forecast · None'));
    const firstValue=await page.locator('.fin-metric').filter({has:page.locator('#metric-npv')}).locator('.fin-value').first().innerText();
    check(device,'sourced USD NPV displayed',firstValue.includes('USD')&&firstValue!=='—');
    check(device,'cash series visible',await page.locator('canvas[role=img]').isVisible());
    check(device,'missing actuals are explicit',(await page.locator('.fin-panel').filter({has:page.getByRole('heading',{name:/Budget Execution/})}).innerText()).includes('Data missing'));
    check(device,'CQA operating basis separated',(await page.locator('.fin-metric').filter({has:page.locator('#metric-operating_profit')}).innerText()).includes('Awaiting finance approval'));
    await page.screenshot({path:join(privateDir,device+'-cqa-dashboard.png'),fullPage:true});
    await page.locator('a[href="/#projects"]').filter({hasText:'Project Overview'}).click();
    await page.locator('.finance-project-entry[href="'+dashboard(run.projectId)+'"]').click();
    await page.locator('#metric-npv').waitFor();
    check(device,'project card opens same baseline and value',await page.locator('#fin-filter-baseline').inputValue()===run.baselineId&&
      await page.locator('.fin-metric').filter({has:page.locator('#metric-npv')}).locator('.fin-value').first().innerText()===firstValue);
    check(device,'Timing remains available',await page.locator('a[href="/projects/'+run.projectId+'/timing"]').isVisible());
    const glossary=page.locator('[data-definition=npv]').first();
    if(device==='mobile')await glossary.tap();else await glossary.hover();
    check(device,'Chinese NPV definition',(await page.locator('#fin-definition').innerText()).includes('净现值'));
    await page.getByRole('button',{name:'Close',exact:true}).click();
    check(device,'definition close restores focus',await glossary.evaluate(el=>el===document.activeElement));
    if(device==='desktop') {
      await page.locator('#metric-npv').focus();await page.keyboard.press('Tab');
      check(device,'keyboard definition opens',await page.locator('#fin-definition').isVisible());
      await page.keyboard.press('Escape');
      check(device,'Escape closes definition and keeps focus',await glossary.evaluate(el=>el===document.activeElement)&&await page.locator('#fin-definition').count()===0);
    }
    await page.locator('.fin-metric').filter({has:page.locator('#metric-npv')}).getByRole('button',{name:'Sources'}).first().click();
    check(device,'source trace contains calculation version and workbook cell',(await page.locator('.fin-source-dialog').innerText()).includes('P06.1')&&
      (await page.locator('.fin-source-dialog').innerText()).includes('C182'));
    await page.screenshot({path:join(privateDir,device+'-cqa-source.png')});
    await page.locator('.fin-source-dialog button').click();
    await page.locator('#fin-filter-period').selectOption('year-2020');
    await page.waitForURL('**/finance?**period=year-2020**');
    await page.locator('#fin-filter-product').selectOption('double_buckle');
    await page.waitForURL('**/finance?**product=double_buckle**');
    await page.locator('#metric-operating_profit').click();
    await page.locator('#source-ame\\:35\\:cycle_time').click();
    await page.locator('#fin-impact-form').waitFor();
    const deep=page.url();
    await page.reload();
    await page.locator('#fin-impact-form').waitFor();
    check(device,'source deep-link refresh restores period and product',page.url()===deep&&await page.locator('#fin-filter-period').inputValue()==='year-2020'&&
      await page.locator('#fin-filter-product').inputValue()==='double_buckle');
    const override=page.locator('#fin-impact-form input[name=value]');
    await override.fill(String(Math.round(Number(await override.inputValue())+6)));
    const preview=page.waitForResponse(res=>res.url().endsWith('/preview')&&res.request().method()==='POST');
    await page.getByRole('button',{name:'Preview Change'}).click();
    check(device,'uses server preview', (await preview).status()===200);
    await page.getByText('Preview ready.',{exact:false}).waitFor();
    check(device,'impact path, before/candidate and effective period visible',(await page.locator('#fin-impact-result').innerText()).includes('Impact path')&&
      (await page.locator('#fin-impact-result').innerText()).includes('Before edit')&&(await page.locator('#fin-impact-result').innerText()).includes('2020'));
    check(device,'frozen baseline cannot be saved',await page.locator('#fin-save').count()===0);
    await page.screenshot({path:join(privateDir,device+'-cqa-impact.png')});
    page.once('dialog',dialog=>dialog.dismiss());
    await page.locator('.fin-back').click();
    check(device,'declining return retains candidate',page.url()===deep&&await override.isVisible());
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('.fin-back').click();
    await page.locator('#source-ame\\:35\\:cycle_time').waitFor();
    await page.waitForFunction(()=>document.activeElement?.id==='source-ame:35:cycle_time');
    check(device,'explicit return restores source row focus and filters',await page.locator('#fin-filter-period').inputValue()==='year-2020');
    await page.goForward();
    await page.locator('#fin-impact-form').waitFor();
    check(device,'browser forward restores source',page.url()===deep);
    await page.goBack();
    await page.locator('.fin-back').click();
    await page.locator('#metric-npv').waitFor();
    await page.waitForFunction(()=>document.activeElement?.id==='metric-operating_profit');
    check(device,'explicit return restores originating metric',await page.locator('#fin-filter-product').inputValue()==='double_buckle');
    for(const suffix of ['commercial','bom','operations','factory-costs','engineering','prototypes','validation','investment','returns','budget','compare']) {
      const response=await page.goto(base+dashboard(run.projectId)+'/'+suffix+'?period=year-2020&product=double_buckle');
      await page.locator('#fin-filter-period').waitFor();
      check(device,'refreshable '+suffix,response.status()===200&&await page.locator('#fin-filter-period').inputValue()==='year-2020');
    }
    await page.goto(base+dashboard(run.empty));
    await page.getByRole('heading',{name:'No approved baseline'}).waitFor();
    check(device,'empty project displays no fabricated cards',await page.locator('.fin-metric').count()===0);
    await page.screenshot({path:join(publicDir,device+'-empty.png'),fullPage:true});
    await page.goto(base+dashboard(run.synthetic));
    await page.locator('#metric-npv').waitFor();
    check(device,'synthetic current and baseline comparison has calculated delta',(await page.locator('.fin-metric').filter({has:page.locator('#metric-npv')}).innerText()).includes('-1,818.18'));
    check(device,'page has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:join(publicDir,device+'-dashboard.png'),fullPage:true});
    await page.locator('#metric-operating_profit').click();
    await page.locator('#source-cycle_time').click();
    await page.locator('#fin-impact-form input[name=value]').fill('42');
    await page.getByRole('button',{name:'Preview Change'}).click();
    await page.getByText('Preview ready.',{exact:false}).waitFor();
    check(device,'editable draft can save a preview',await page.locator('#fin-save').isEnabled());
    await page.screenshot({path:join(publicDir,device+'-impact.png')});
    if(device==='desktop'&&process.env.P07_VERIFY_SAVE==='1'){
      // Save only in the disposable synthetic review version.
      const save=page.waitForResponse(res=>res.request().method()==='PUT'&&res.url().includes('/finance/versions/'));
      await page.locator('#fin-save').click();check(device,'draft save via P06', (await save).status()===200);
      await page.waitForFunction(()=>document.querySelector('#fin-impact-form input')?.value==='42'&&document.querySelector('#fin-impact-status')?.textContent==='');
      await page.reload();await page.locator('#fin-impact-form').waitFor();
      check(device,'saved draft survives reload',await page.locator('#fin-impact-form input').inputValue()==='42');
      await page.locator('#fin-impact-form input').fill('36');
      await page.getByRole('button',{name:'Preview Change'}).click();
      await page.getByText('Preview ready.',{exact:false}).waitFor();
      const restore=page.waitForResponse(res=>res.request().method()==='PUT'&&res.url().includes('/finance/versions/'));
      await page.locator('#fin-save').click();assert.equal((await restore).status(),200);
      await page.waitForFunction(()=>document.querySelector('#fin-impact-form input')?.value==='36'&&document.querySelector('#fin-impact-status')?.textContent==='');
    }
    check(device,'no browser JavaScript errors',errors.length===0);
    await context.close();
  }
  for(const audience of ['reader','outside']) {
    const context=await browser.newContext(),page=await context.newPage();
    await login(page,accounts[audience]);
    await page.locator('.finance-nav-entry').click();
    if(audience==='reader'){
      await page.locator('#metric-npv').waitFor();
      check(audience,'single authorized project opens directly',page.url().includes(dashboard(run.projectId)));
      await page.locator('#metric-operating_profit').click();
      await page.locator('#source-ame\\:35\\:cycle_time').click();
      await page.getByText('Read-only source.',{exact:false}).waitFor();
      check(audience,'read-only role cannot edit or preview',await page.locator('#fin-impact-form').count()===0);
    } else {
      await page.getByRole('heading',{name:'No finance projects available'}).waitFor();
      await page.goto(base+dashboard(run.projectId));
      await page.getByRole('heading',{name:'Project unavailable'}).waitFor();
      check(audience,'direct link does not expose name or metrics',await page.locator('.fin-metric').count()===0&&!(await page.locator('#finance-workspace').innerText()).includes('CQA'));
      check(audience,'workspace data rejects direct unauthorized read',(await context.request.get(base+'/api'+dashboard(run.projectId)+'/workspace')).status()===404);
      await page.screenshot({path:join(publicDir,'access-denied.png'),fullPage:true});
    }
    await context.close();
  }
  await writeFile(join(publicDir,'browser-checks.json'),JSON.stringify({base,recordedAt:new Date().toISOString(),checks:results.length,results},null,2)+'\n');
  console.log(JSON.stringify({checks:results.length,status:'passed'}));
} finally {await browser.close();}
