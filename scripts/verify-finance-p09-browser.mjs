import {financeReviewConfig} from './finance-review-config.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const {base,run,evidence}=await financeReviewConfig('p09',18749);
const accounts=JSON.parse(await readFile(run.credentials,'utf8'));
const privateDir=join(run.directory,'browser');
await mkdir(evidence,{recursive:true});await mkdir(privateDir,{recursive:true});
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-proxy-server']});
const checks=[];
function check(name,condition){assert.ok(condition,name);checks.push(name);}
const dashboard=id=>'/projects/'+id+'/finance';
const operations=dashboard(run.synthetic)+'/operations';

async function login(page,account){
  await page.goto(base);
  await page.locator('#login').click();
  await fill(page.locator('#login-form'),{id:account.id,password:account.password});
  await page.locator('#login-form button').click();
  await page.waitForFunction(()=>document.querySelector('#login')?.textContent?.includes('退出'));
}
async function fill(parent,values){
  for(const [name,value] of Object.entries(values))await parent.locator('input[name="'+name+'"]').fill(value);
}
const form=page=>page.locator('#fin-impact-form');
const review={reviewer:'ME Review',reference:'Synthetic work study evidence'};
async function preview(page,blocked=false){
  const waiting=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/preview')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Preview Change'}).click();
  const response=await waiting;
  assert.equal(response.status(),200,await response.text());
  const payload=await response.json();
  assert.equal(payload.saveBlocked,blocked);
  await page.getByText(blocked?'The candidate cannot be saved.':'Preview ready.',{exact:false}).waitFor();
  return payload;
}
async function save(page,preview){
  const waiting=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/finance/versions/'));
  await page.getByRole('button',{name:'Save Draft'}).click();
  const response=await waiting;
  assert.equal(response.status(),200,await response.text());
  const saved=await response.json();
  check('Preview and save have the same calculation digest',saved.calculationSha256===preview.calculationSha256);
  await page.locator('.fin-op-product').first().waitFor();
  await page.waitForFunction(()=>!document.querySelector('#fin-impact-status')?.textContent);
  return preview.fields[0].key;
}
async function design(page,revision,stations){
  await page.locator('#fin-design-product-a').click();
  const edit=form(page);
  await fill(edit,{revision,...review});
  await fill(edit.locator('[data-ops-group=line]'),{line:'Line-A',hours:'8',days:'30',oee:'0.9'});
  for(const [i,station] of stations.entries()){
    if(i>0)await edit.getByRole('button',{name:'Add station'}).click();
    await fill(edit.locator('[data-ops-group=station]').nth(i),{line:'Line-A',...station});
  }
  await save(page,await preview(page));
  await page.getByRole('heading',{name:'Design '+revision,exact:true}).waitFor();
}
async function batch(page,designKey,{lot,stage,hours,readings,revision='1'}){
  if(!new URL(page.url()).pathname.endsWith('/'+designKey))await page.locator('a[id="route-'+designKey+'"]').click();
  await page.locator('#fin-record-batch').click();
  await fill(form(page),{...review,batch:lot,date:'2026-11-18',revision,'person-hours':hours,'good-pieces':'100','factor-Line-A':'0.9',...readings});
  await form(page).locator('[name=stage]').selectOption(stage);
  const key=await save(page,await preview(page));
  await page.getByRole('heading',{name:(stage==='pilot'?'Pilot':'Production')+' · '+lot+' · 2026-11-18 · Rev '+revision,exact:true}).waitFor();
  return key;
}
async function choose(page,key,blocked=false){
  await form(page).locator('[name=operation-source]').selectOption(key);
  await fill(form(page),review);
  return preview(page,blocked);
}

try {
  const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),page=await desktop.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await login(page,accounts.admin);
  await page.locator('.finance-project-entry[href="'+dashboard(run.synthetic)+'"]').click();
  await page.locator('#metric-operating_profit').waitFor();
  await page.locator('#fin-filter-product').selectOption('product-a');
  await page.locator('#fin-filter-period').selectOption('year-1');
  const originalDashboard=new URL(page.url());
  const profit=page.locator('#metric-operating_profit');
  await profit.click();
  await page.getByRole('heading',{name:'Routes & Batch Measurements'}).waitFor();
  check('Normal project card and operating profit open Operations',new URL(page.url()).pathname===operations);
  await page.locator('#fin-rate-product-a').click();
  await fill(form(page),{'hourly-rate':'60',reviewer:'Finance Review',reference:'Synthetic rate calibration'});
  await save(page,await preview(page));
  const s10={station:'S10',operation:'Assemble',people:'2',ct:'30'};
  await design(page,'T2-D1',[s10]);
  const designKey=new URL(page.url()).pathname.split('/').at(-1);
  await save(page,await choose(page,designKey));
  await page.getByText('Active design',{exact:true}).waitFor();
  check('T2 design takt, OEE capacity and labor are independent',(await page.locator('.fin-op-line').innerText()).includes('86.40 s/piece')&&
    (await page.locator('.fin-op-line').innerText()).includes('25920 good pieces/period')&&(await page.locator('.fin-op-product').innerText()).includes('1.0000 CNY/piece'));
  const measured=await batch(page,designKey,{lot:'T2-PILOT',stage:'pilot',hours:'2',readings:{'ct-S10':'36'}});
  const t2=await choose(page,measured),metrics=t2.comparison.metrics,year=t2.comparison.products['product-a'].periodic[1];
  const reconciliation={
    unitLabor:[year.unit_labor.before.displayValue,year.unit_labor.after.displayValue,year.unit_labor.delta.displayValue],
    annualDirectLabor:[year.labor.before.displayValue,year.labor.after.displayValue,year.labor.delta.displayValue],
    annualCashFlow:[year.cash_flow.before.displayValue,year.cash_flow.after.displayValue,year.cash_flow.delta.displayValue],
    operatingProfitDelta:metrics.operating_profit.delta.displayValue,npvDelta:metrics.npv.delta.displayValue
  };
  assert.deepEqual(reconciliation,{unitLabor:['1.0000','1.2000','0.2000'],annualDirectLabor:['10000.00','12000.00','2000.00'],
    annualCashFlow:['110000.00','108000.00','-2000.00'],operatingProfitDelta:'-2000.00',npvDelta:'-1818.18'});
  check('T2 reconciles unit labor, annual labor, profit, cash flow and NPV and traces their dependencies',
    t2.paths.some(path=>['unit_labor','labor','cash_flow','npv'].every(metric=>path.nodes.some(node=>node.metricKey===metric))));
  await page.locator('#fin-impact-result h3').first().evaluate(node=>node.scrollIntoView({block:'start'}));
  await page.screenshot({path:join(evidence,'desktop-t2-impact.png')});
  await save(page,t2);
  await page.reload();await page.getByText('Active measured',{exact:true}).waitFor();
  check('Saved measured basis survives source deep-link reload',(await page.locator('.fin-op-product').innerText()).includes('Current unit labor 1.2000 CNY/piece'));
  await page.goto(originalDashboard.href);
  await profit.click();
  await page.locator('a[id="route-'+measured+'"]').click();
  await form(page).waitFor();
  await page.locator('.fin-impact > summary').click();
  await page.locator('.fin-back').click();
  await page.getByRole('heading',{name:'Routes & Batch Measurements'}).waitFor();
  await page.locator('.fin-back').click();
  await page.locator('#metric-operating_profit').waitFor();
  check('Explicit return restores the original dashboard URL and filters',page.url()===originalDashboard.href);
  await page.locator('#metric-npv').click();
  await page.getByRole('heading',{name:'Period Cash Flow',exact:false}).waitFor();
  check('Returns shows the saved Year 1 cash flow',(await page.locator('#finance-workspace').innerText()).includes('108,000.00 CNY'));
  await page.locator('.fin-back').click();await profit.click();

  await design(page,'BALANCE-D2',[s10,{station:'S20',operation:'Inspect',people:'1',ct:'24'}]);
  const balanceDesign=new URL(page.url()).pathname.split('/').at(-1);
  await page.locator('.fin-op-line tr').filter({hasText:'S10'}).getByText('Bottleneck').waitFor();
  const production=await batch(page,balanceDesign,{lot:'PROD-01',stage:'production',hours:'3.5',readings:{'ct-S10':'29','ct-S20':'38'}});
  await page.locator('.fin-op-line tr').filter({hasText:'S20'}).getByText('Bottleneck').waitFor();
  check('Measured CT transfers bottleneck from S10 to S20',(await page.locator('.fin-op-line').innerText()).includes('88.16%'));
  await page.locator('.fin-impact > summary').click();
  await page.locator('.fin-op-line h4').scrollIntoViewIfNeeded();
  await page.screenshot({path:join(evidence,'desktop-bottleneck.png')});
  const incomplete=await batch(page,balanceDesign,{lot:'PROD-01',stage:'production',revision:'2',hours:'3.5',readings:{'ct-S10':'29'}});
  const invalid=await choose(page,incomplete,true);
  check('Missing station prevents basis adoption with a named error',await page.getByRole('button',{name:'Save Draft'}).isDisabled()&&
    invalid.errors.some(error=>error.message.includes('Missing cycle time at S20')));
  await page.locator('.fin-impact > summary').click();
  check('Missing station leaves line balance, constraint and capacity unavailable',
    await page.locator('.fin-op-metrics dd').filter({hasText:/^Unavailable$/}).count()===3&&
    (await page.locator('.fin-op-line').getByText('Bottleneck',{exact:true}).count())===0);
  await page.locator('.fin-op-line h4').scrollIntoViewIfNeeded();
  await page.screenshot({path:join(evidence,'desktop-missing-station.png')});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('a[id="route-'+production+'"]').click();
  await save(page,await choose(page,designKey));
  await page.getByText('Active design',{exact:true}).waitFor();
  check('Management can switch from measured back to design',(await page.locator('.fin-op-product').innerText()).includes('Current unit labor 1.0000 CNY/piece'));
  await save(page,await choose(page,measured));
  await desktop.close();

  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),phone=await mobile.newPage();
  phone.on('pageerror',error=>errors.push(error.message));
  await login(phone,accounts.admin);
  await phone.locator('.finance-nav-entry').click();
  await phone.locator('#project-'+run.synthetic).click();
  await phone.locator('#module-operations').click();
  await phone.getByText('Active measured',{exact:true}).waitFor();
  check('Mobile normal navigation opens the persisted measured basis',await phone.getByText('Active measured',{exact:true}).isVisible());
  check('Mobile Operations stays within viewport',await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await phone.locator('.fin-op-product h3').first().scrollIntoViewIfNeeded();
  await phone.screenshot({path:join(evidence,'mobile-operations.png')});
  await phone.locator('a[id="route-'+measured+'"]').click();
  await form(phone).locator('[name=operation-source]').selectOption(designKey);
  await fill(form(phone),review);
  const reverse=await preview(phone);
  check('Mobile reverse preview adds back the T2 NPV difference',reverse.comparison.metrics.npv.delta.displayValue==='1818.18');
  await phone.locator('#fin-impact-result h3').first().evaluate(node=>node.scrollIntoView({block:'start'}));
  await phone.screenshot({path:join(evidence,'mobile-impact.png')});
  phone.once('dialog',dialog=>dialog.accept());
  await phone.locator('.fin-back').click();
  await phone.getByText('Active measured',{exact:true}).waitFor();
  check('Mobile returns focus to the source row',await phone.evaluate(key=>document.activeElement?.id==='route-'+key,measured));
  await mobile.close();

  const archive=await browser.newContext({viewport:{width:1440,height:1000}}),arch=await archive.newPage();
  await login(arch,accounts.reader);
  await arch.locator('.finance-project-entry[href="'+dashboard(run.projectId)+'"]').click();
  await arch.locator('#module-operations').click();
  for(const [product,repeats] of [['double_buckle','2'],['single_buckle','1']]){
    await arch.locator('#fin-filter-product').selectOption(product);
    await arch.locator('.fin-op-archive summary').click();
    const rows=arch.locator('.fin-op-archive tbody tr');
    check(product+' preserves shared AME lines 35/36 and the P05 repeats per piece',await rows.count()===2&&
      (await rows.allTextContents()).every(row=>row.includes('Shared'))&&
      (await arch.locator('.fin-op-archive tbody td:nth-child(4)').allTextContents()).every(value=>value===repeats));
    await arch.screenshot({path:join(privateDir,product+'.png')});
    check(product+' read-only browser account cannot submit or calibrate',await arch.getByRole('link',{name:'Submit design'}).count()===0&&
      await arch.getByRole('link',{name:'Calibrate rate'}).count()===0);
  }
  await archive.close();
  check('No uncaught script errors',errors.length===0);
  await writeFile(join(evidence,'browser-checks.json'),JSON.stringify({step:'P09',browser:'Chrome',viewports:[[1440,1000],[390,844]],checks,reconciliation},null,2)+'\n');
} finally {await browser.close();}
