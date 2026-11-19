import {financeReviewConfig} from './finance-review-config.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const {base,run,evidence}=await financeReviewConfig('p08',18748);
const accounts=JSON.parse(await readFile(run.credentials,'utf8'));
const publicDir=evidence,privateDir=join(run.directory,'browser');
await mkdir(publicDir,{recursive:true});await mkdir(privateDir,{recursive:true});
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-proxy-server']});
const checks=[];
function check(device,name,value) {assert(value,device+' / '+name);checks.push({device,check:name,status:'passed'});}
function route(project,section=''){return '/projects/'+project+'/finance'+(section?'/'+section:'');}

async function login(page,account) {
  await page.goto(base);await page.locator('#login').click();
  await page.locator('#login-form input[name=id]').fill(account.id);
  await page.locator('#login-form input[name=password]').fill(account.password);
  await page.locator('#login-form button').click();
  await page.waitForFunction(()=>document.querySelector('#login')?.textContent?.includes('退出'));
}
async function findRow(page,label,part) {
  const scope=part?page.locator('tr').filter({hasText:part}):page;
  const link=scope.getByRole('link',{name:label,exact:true}).first();
  await link.waitFor();
  const id=await link.getAttribute('id');
  await link.click();await page.locator('#fin-impact-form input[name=value]').waitFor();
  return id;
}
async function preview(page,value) {
  await page.locator('#fin-impact-form input[name=value]').fill(value);
  const wait=page.waitForResponse(res=>new URL(res.url()).pathname.endsWith('/preview')&&res.request().method()==='POST');
  await page.getByRole('button',{name:'Preview Change'}).click();
  const response=await wait;
  assert.equal(response.status(),200,await response.text());
  const payload=await response.json();
  await page.getByText('Preview ready.',{exact:false}).waitFor();
  return payload;
}
async function save(page,value) {
  const wait=page.waitForResponse(res=>res.request().method()==='PUT'&&res.url().includes('/finance/versions/'));
  await page.locator('#fin-save').click();const res=await wait;
  assert.equal(res.status(),200,await res.text());
  await page.waitForFunction(expected=>document.querySelector('#fin-impact-form input[name=value]')?.value===expected&&
    document.querySelector('#fin-impact-status')?.textContent==='',value);
  return res.json();
}

try {
  for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    const context=await browser.newContext({viewport,hasTouch:device==='mobile'}),page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await login(page,accounts.admin);
    await page.locator('.finance-project-entry[href="'+route(run.synthetic)+'"]').click();
    await page.locator('#metric-npv').waitFor();
    await page.locator('#fin-filter-product').selectOption('product-a');
    await page.locator('#fin-filter-period').selectOption('year-1');
    await page.waitForURL('**period=year-1**');
    for(const item of [
      {section:'bom',entry:'#metric-bom',label:'Supplier unit price',before:'4',after:'5',profit:'-2000.00',npv:'-1818.18'},
      {section:'commercial',entry:'#metric-revenue',label:'Selling price',before:'20',after:'22',profit:'2000.00',npv:'1818.18'},
      {section:'factory-costs',entry:'#metric-factory',label:'Variable manufacturing overhead',before:'1',after:'1.25',profit:'-250.00',npv:'-227.27'}
    ]) {
      await page.locator(item.entry).click();
      await page.waitForURL('**/finance/'+item.section+'?**');
      if(item.section!=='factory-costs'){
        await page.locator('#fin-filter-market').selectOption('eu');
        await page.waitForURL('**market=eu**');
      }
      if(item.section==='commercial')await page.locator('#fin-sales-inputs').click();
      await page.locator('.fin-panel table').waitFor();
      check(device,item.section+' table is reachable',await page.locator('.fin-panel table').isVisible());
      await page.screenshot({path:join(publicDir,device+'-'+item.section+'.png'),fullPage:true});
      const focus=await findRow(page,item.label,item.section==='bom'?'T3-CLIP':undefined);
      check(device,item.section+' initial source value',await page.locator('#fin-impact-form input[name=value]').inputValue()===item.before);
      const simulated=await preview(page,item.after);
      check(device,item.section+' impact answers profit, NPV and source',simulated.comparison.metrics.operating_profit.delta.displayValue===item.profit&&
        simulated.comparison.metrics.npv.delta.displayValue===item.npv&&simulated.fields[0].period==='year-1'&&simulated.persisted===false);
      if(item.section==='bom'){
        const product=simulated.comparison.products['product-a'].periodic[1];
        check(device,'T3 unit cost and annual direct material',product.unit_material.delta.displayValue==='2.0000'&&product.material.delta.displayValue==='2000.00');
        check(device,'T3 detailed impact and lifecycle shown',await page.getByRole('heading',{name:'Unit and period impact'}).isVisible()&&
          await page.getByRole('heading',{name:'Lifecycle impact'}).isVisible());
        await page.getByRole('heading',{name:'Unit and period impact'}).evaluate(heading=>heading.scrollIntoView({block:'start'}));
        await page.screenshot({path:join(publicDir,device+'-t3-impact.png')});
      }
      const saved=await save(page,item.after);
      check(device,item.section+' saved calculation matches preview',saved.calculationSha256===simulated.calculationSha256);
      await page.reload();await page.locator('#fin-impact-form input[name=value]').waitFor();
      check(device,item.section+' saved value survives reload',await page.locator('#fin-impact-form input[name=value]').inputValue()===item.after);
      await preview(page,item.before);await save(page,item.before);
      await page.locator('.fin-back').click();await page.waitForURL('**/finance/'+item.section+'?**');
      await page.waitForFunction(id=>document.activeElement?.id===id,focus);
      check(device,item.section+' returns to same source focus and scope',await page.locator('#fin-filter-period').inputValue()==='year-1'&&
        await page.locator('#fin-filter-product').inputValue()==='product-a'&&
        (item.section==='factory-costs'||await page.locator('#fin-filter-market').inputValue()==='eu'));
      await page.getByRole('link',{name:'Dashboard',exact:true}).click();
    }
    await page.goto(base+route(run.projectId,'commercial')+'?version='+run.archiveDraft+'&period=year-2020&product=outboard');
    await page.locator('#fin-sales-inputs').click();
    await page.getByRole('link',{name:'Annual price reduction',exact:true}).first().waitFor();
    check(device,'real CQA commercial rows have worksheet sources',(await page.locator('#finance-workspace').innerText()).includes('Vol_SBS_Updated'));
    const anchor=await findRow(page,'Annual price reduction');
    await page.locator('#fin-impact-form select[name=end]').selectOption('year-2021');
    const yearReduction=await preview(page,'0.15');
    check(device,'real CQA annual reduction can be previewed across two periods',yearReduction.fields.length===2&&
      yearReduction.fields[1].period==='year-2021'&&yearReduction.affectedPeriods.includes('year-2022'));
    await page.screenshot({path:join(privateDir,device+'-cqa-reduction.png')});
    page.once('dialog',dialog=>dialog.accept());await page.locator('.fin-back').click();
    await page.waitForFunction(id=>document.activeElement?.id===id,anchor);
    for(const section of ['bom','factory-costs']){
      const res=await page.goto(base+route(run.projectId,section)+'?version='+run.archiveDraft+'&period=year-2020&product=outboard');
      await page.locator('.fin-panel table').waitFor();
      check(device,'real CQA '+section+' has refreshable sourced rows',res.status()===200&&await page.locator('.fin-panel tbody tr').count()>0);
    }
    check(device,'business pages fit the viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    check(device,'no browser runtime errors',errors.length===0);
    await context.close();
  }
  const createContext=await browser.newContext(),entry=await createContext.newPage();
  await login(entry,accounts.admin);
  await entry.goto(base+route(run.synthetic,'bom')+'?period=year-1&product=product-a&market=eu');
  await entry.getByRole('link',{name:'Add record',exact:true}).click();
  const form=entry.locator('#fin-impact-form'),part='P08-ENTRY-'+Date.now();
  await form.locator('[name=partNumber]').fill(part);
  await form.locator('[name=reference]').fill('Browser entry validation');
  await form.locator('[name="field:part_quantity"]').fill('0');
  await form.locator('[name="field:part_price"]').fill('1');
  const entryPreview=entry.waitForResponse(res=>new URL(res.url()).pathname.endsWith('/preview'));
  await form.getByRole('button',{name:'Preview Change'}).click();
  const candidate=await (await entryPreview).json();
  await entry.getByText('Preview ready.',{exact:false}).waitFor();
  check('desktop','new BOM form previews a source record without writes',candidate.fields.every(field=>field.before===null)&&candidate.fields.length===3);
  const entrySave=entry.waitForResponse(res=>res.request().method()==='PUT');
  await entry.locator('#fin-save').click();
  check('desktop','new record save uses the preview result',(await (await entrySave).json()).calculationSha256===candidate.calculationSha256);
  await entry.waitForURL(url=>url.pathname.endsWith('/bom'));
  await entry.locator('#fin-business-search input').fill(part);
  await entry.getByRole('button',{name:'Find',exact:true}).click();
  await entry.locator('tr').filter({hasText:part}).first().waitFor();
  check('desktop','new edit reopens with stable part number and source',(await entry.locator('tr').filter({hasText:part}).first().innerText()).includes('Browser entry validation'));
  await createContext.close();
  const reader=await browser.newContext(),page=await reader.newPage();await login(page,accounts.reader);
  await page.goto(base+route(run.projectId,'commercial')+'?period=year-2020&product=outboard');
  await page.locator('#fin-sales-inputs').click();
  await page.getByRole('link',{name:'Selling price',exact:true}).first().click();
  await page.getByText('Read-only source.',{exact:false}).waitFor();
  check('reader','authorized read-only viewer has no preview or add controls',await page.locator('#fin-impact-form,#fin-add-business').count()===0);
  await reader.close();
  await writeFile(join(publicDir,'browser-checks.json'),JSON.stringify({step:'P08',time:new Date().toISOString(),checks:checks.length,results:checks},null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,status:'passed'}));
} finally {await browser.close();}
