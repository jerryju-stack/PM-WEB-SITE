import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const index=resolve('.deploy/finance-p14/latest-run.json');
const run=JSON.parse(await readFile(index,'utf8')),accounts=JSON.parse(await readFile(run.credentials,'utf8'));
const base='http://127.0.0.1:'+run.port;
const evidence='docs/validation/project-finance/P14';
const workflowDir=join(run.directory,'workflow-evidence');
const steps=['08','09','10','11','12','13'];
if(process.argv.includes('--workflows')){
  for(const step of steps)execFileSync(process.execPath,['scripts/verify-finance-p'+step+'-browser.mjs'],{
    env:{...process.env,FINANCE_P14_INDEX:index},stdio:'inherit'});
}
await mkdir(evidence,{recursive:true});
const workflows={};
for(const step of steps){
  const rows=JSON.parse(await readFile(join(workflowDir,'p'+step,'browser-checks.json'),'utf8'));
  workflows['P'+step]=rows;
}
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-proxy-server']});
const dashboard=id=>'/projects/'+id+'/finance';
const business=dashboard(run.scenarios.p08),existing=dashboard(run.projectId);
const api=id=>base+'/api/projects/'+id+'/finance';
const checks=[],roles={},terms=new Set(),routes={},errors=[];
const check=(name,test)=>{assert.ok(test,name);checks.push(name);};
const root=page=>page.locator('#finance-workspace');
const request=async response=>{assert.ok(response.ok(),'HTTP '+response.status()+' '+new URL(response.url()).pathname);return response.json();};
const payload=(reason,values={})=>({requestKey:randomUUID(),reason,...values});
const tooltip=page=>page.locator('#fin-definition [lang=zh-CN]').first();
const keyButton=(page,key)=>page.locator('[data-definition="'+key+'"]').first();
async function pageFor(account,mobile=false){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.locator('#login').click();
  await page.locator('#login-form input[name=id]').fill(account.id);
  await page.locator('#login-form input[name=password]').fill(account.password);
  await page.locator('#login-form button').click();
  await page.waitForFunction(()=>document.querySelector('#login')?.textContent?.includes('退出'));
  return page;
}
async function fromHome(page,id,mode='card'){
  await page.goto(base);
  if(mode==='card')await page.locator('.finance-project-entry[href="'+dashboard(id)+'"]').click();
  else {
    await page.locator('.finance-nav-entry').click();
    await page.waitForFunction(id=>location.pathname==='/projects/'+id+'/finance'||!!document.getElementById('project-'+id),id);
    if(new URL(page.url()).pathname==='/finance')await page.locator('#project-'+id).click();
  }
  await page.locator('#metric-revenue').waitFor();
}
async function inspectTerms(page,context){
  const result=await page.evaluate(covered=>{
    const buttons=[...document.querySelectorAll('[data-definition]')];
    const actual=new Map(buttons.map(btn=>[btn.dataset.definition,btn]));
    const requested=new Set([...document.querySelectorAll('[data-finance-metric]')].map(node=>node.dataset.financeMetric));
    const missing=[...requested].filter(key=>!actual.has(key)),checked=[];
    for(const [key,button] of actual){
      if(covered.includes(key))continue;
      button.click();
      const text=document.querySelector('#fin-definition [lang="zh-CN"]')?.textContent??'';
      if(!/\p{Script=Han}/u.test(text)||text.length<7||button.getAttribute('aria-expanded')!=='true')missing.push(key);
      else checked.push(key);
      document.querySelector('#fin-definition [data-close-help]')?.click();
    }
    return {missing,checked};
  },[...terms]);
  assert.deepEqual(result.missing,[],context+' has undefined or untranslated metric keys');
  for(const key of result.checked)terms.add(key);
}
async function screenshot(page,name){await page.screenshot({path:join(evidence,name)});}
async function back(page,expected){
  await page.locator('.fin-back').click();
  await page.locator('#metric-revenue').waitFor();
  assert.equal(page.url(),expected);
}

try{
  const admin=await pageFor(accounts.admin);
  await fromHome(admin,run.projectId);
  const existingURL=admin.url(),dashboardData=await request(await admin.request.get(api(run.projectId)+'/workspace'));
  check('Existing project loads P05 frozen CQA from the normal home card',dashboardData.baseline.details.id===run.baselineId&&
    dashboardData.baseline.details.status==='frozen'&&dashboardData.baseline.productLabels.length===4&&dashboardData.baseline.periods.length===11);
  check('CQA shows historical MPBITRI and keeps standard operating profit pending',
    dashboardData.baseline.metrics.operating_profit.status==='pending_finance'&&(await root(admin).innerText()).includes('MPBITRI'));
  await inspectTerms(admin,'existing CQA dashboard');
  const metricRoutes={revenue:'commercial',operating_profit:'operations',npv:'returns',irr:'returns',payback_period:'returns',peak_funding_requirement:'returns'};
  for(const [key,section] of Object.entries(metricRoutes)){
    await admin.locator('#metric-'+key).click();
    await admin.waitForURL(url=>url.pathname===existing+'/'+section);
    await root(admin).locator('h1').waitFor();
    await inspectTerms(admin,key);
    const metric=dashboardData.baseline.metrics[key];
    assert.ok(metric&&metric.formula,key);
    if(key!=='operating_profit')assert.ok(metric.exact,key+' has an exact archived result');
    await back(admin,existingURL);
    check('Home card opens its source workflow and returns · '+key,true);
  }

  const modules={commercial:['p08','Selling price'],bom:['p08','Supplier unit price'],operations:['p09','Routes & Batch Measurements'],
    'factory-costs':['p08','Variable manufacturing overhead'],engineering:['p10','PM Planning Hours'],prototypes:['p10','T4 Sample Batch'],
    validation:['p10','T4 Retest'],investment:['p11','T5 Assembly Equipment'],returns:['p11','Period Cash Flow'],budget:['p12','T6 Engineering Services']};
  for(const [section,[step,marker]] of Object.entries(modules)){
    const cfg=run.cases[step],id=cfg.synthetic??cfg.project;
    await fromHome(admin,id);
    if(['commercial','bom','operations','factory-costs','engineering','prototypes','validation'].includes(section)){
      await admin.locator('#fin-filter-product').selectOption('product-a');
      await admin.waitForURL(url=>url.searchParams.get('product')==='product-a');
      await admin.locator('#fin-filter-period').selectOption(section==='engineering'?'year-0':'year-1');
      await admin.waitForURL(url=>url.searchParams.get('period')===(section==='engineering'?'year-0':'year-1'));
    }
    const expected=admin.url();
    const click=async()=>{await admin.locator('#module-'+section).click();await admin.waitForURL(url=>url.pathname===dashboard(id)+'/'+section);};
    await click();
    await root(admin).getByText(marker,{exact:false}).first().waitFor();
    await inspectTerms(admin,section);
    const deep=admin.url();
    await admin.reload();await root(admin).getByText(marker,{exact:false}).first().waitFor();
    check('Module loaded backed data and supports deep refresh · '+section,admin.url()===deep);
    await back(admin,expected);
    check('Module return restores the same project and filters · '+section,true);
    routes[section]={case:step.toUpperCase(),sourceMarker:marker,refresh:true,return:true};
  }
  await fromHome(admin,run.scenarios.p08);
  for(const [section,label,marker] of [['budget','Budget Execution','Budget Execution'],['returns','Project Returns','Period Cash Flow'],['compare','Version Comparison','NPV Bridge']]){
    const from=admin.url();
    await root(admin).locator('nav').getByRole('link',{name:label,exact:true}).click();
    await root(admin).getByRole('heading',{name:marker,exact:false}).first().waitFor();
    await inspectTerms(admin,'report '+section);
    check('Report reachable through its normal report tab · '+section,new URL(admin.url()).pathname===business+'/'+section);
    await back(admin,from);
  }
  const rev=keyButton(admin,'revenue');
  await rev.hover();
  check('Mouse hover opens the Chinese Revenue definition',/营业收入/.test(await tooltip(admin).innerText()));
  await admin.keyboard.press('Escape');
  check('Escape closes the tooltip',await tooltip(admin).count()===0);
  await admin.locator('#metric-operating_profit').focus();
  await admin.keyboard.press('Tab');
  check('Keyboard Tab focuses the Operating Profit help and opens its Chinese definition',
    await keyButton(admin,'operating_profit').evaluate(node=>node===document.activeElement)&&/经营利润/.test(await tooltip(admin).innerText()));
  await screenshot(admin,'desktop-keyboard-glossary.png');
  await admin.keyboard.press('Escape');
  check('Closing from the keyboard preserves help focus',await keyButton(admin,'operating_profit').evaluate(node=>node===document.activeElement));

  const narrow=await pageFor(accounts.businessReader,true);
  await fromHome(narrow,run.scenarios.p08,'navigation');
  await keyButton(narrow,'irr').tap();
  check('Touch tap opens the Chinese IRR definition',/内部收益率/.test(await tooltip(narrow).innerText()));
  await screenshot(narrow,'mobile-touch-glossary.png');
  await narrow.locator('[data-close-help]').tap();
  check('Touch Close dismisses the definition and restores trigger focus',await tooltip(narrow).count()===0&&
    await keyButton(narrow,'irr').evaluate(node=>node===document.activeElement));
  const mobileURL=narrow.url();
  await narrow.locator('#module-bom').tap();
  await root(narrow).getByRole('row').filter({hasText:'T3-CLIP'}).getByRole('link',{name:'Supplier unit price',exact:true}).tap();
  await root(narrow).locator('.fin-impact [data-finance-metric="p08.part_price"]').waitFor();
  const sourceURL=narrow.url();
  await narrow.goBack();
  await root(narrow).getByRole('row').filter({hasText:'T3-CLIP'}).getByRole('link',{name:'Supplier unit price',exact:true}).waitFor();
  await narrow.goForward();
  await root(narrow).locator('.fin-impact [data-finance-metric="p08.part_price"]').waitFor();
  await narrow.reload();
  await root(narrow).locator('.fin-impact [data-finance-metric="p08.part_price"]').waitFor();
  check('Narrow-screen Back, Forward and reload preserve the exact BOM source and fit the viewport',narrow.url()===sourceURL&&
    await narrow.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check('Reader has no source edit buttons',await narrow.getByRole('button',{name:'Preview Change'}).count()===0);
  await narrow.goto(mobileURL);await narrow.locator('#metric-revenue').waitFor();
  const readonlyPreview={revision:0};
  roles.reader={own:(await narrow.request.get(api(run.scenarios.p08)+'/workspace')).status(),
    other:(await narrow.request.get(api(run.scenarios.p12)+'/workspace')).status(),
    write:(await narrow.request.post(api(run.scenarios.p08)+'/versions/'+run.businessDraft+'/preview',{data:payload('Read-only gate',readonlyPreview)})).status(),
    crossProjectVersion:(await narrow.request.get(api(run.scenarios.p08)+'/versions/'+run.baselineId)).status()};
  assert.deepEqual(roles.reader,{own:200,other:404,write:403,crossProjectVersion:404});
  check('Reader is confined to assigned projects and cannot write or read cross-project version IDs',true);

  const frozenPath=api(run.projectId)+'/versions/'+run.baselineId;
  const frozenBefore=await request(await admin.request.get(frozenPath+'/calculation'));
  roles.admin={frozenWrite:(await admin.request.put(frozenPath,{data:payload('Freeze gate',{revision:dashboardData.baseline.details.revision,
     changeSet:[],effectivePeriod:{from:'year-2020',to:'year-2020'}})})).status()};
  assert.equal(roles.admin.frozenWrite,409);
  const frozenAfter=await request(await admin.request.get(frozenPath+'/calculation'));
  check('Admin cannot mutate the frozen CQA and calculation digest remains identical',
    frozenAfter.calculationSha256===frozenBefore.calculationSha256&&frozenAfter.snapshotSha256===frozenBefore.snapshotSha256);

  const baseline=(await request(await admin.request.get(api(run.scenarios.p08)))).versions.find(row=>row.status==='frozen');
  const draft=await request(await admin.request.post(api(run.scenarios.p08)+'/versions',{data:payload('P14 business role verification',
    {parentId:baseline.id,parentRevision:baseline.revision,name:'P14 · Commercial role rehearsal'})}));
  const maker=await pageFor(accounts.commercial);
  await fromHome(maker,run.scenarios.p08);
  await maker.locator('#fin-filter-version').selectOption(draft.id);
  await maker.waitForURL(url=>url.searchParams.get('version')===draft.id);
  await maker.locator('#metric-revenue').click();
  await root(maker).getByRole('link',{name:'Selling price',exact:true}).click();
  const field=maker.locator('#fin-impact-form input[name=value]');
  await field.fill('21');
  const previewResponse=maker.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/preview')&&r.request().method()==='POST');
  await maker.getByRole('button',{name:'Preview Change'}).click();
  const preview=await request(await previewResponse);
  await maker.getByText('Preview ready.',{exact:false}).waitFor();
  const numbers={revenue:preview.comparison.metrics.revenue.delta.displayValue,profit:preview.comparison.metrics.operating_profit.delta.displayValue,
    npv:preview.comparison.metrics.npv.delta.displayValue};
  assert.deepEqual(numbers,{revenue:'1000.00',profit:'1000.00',npv:'909.09'});
  await inspectTerms(maker,'commercial impact');
  const saveResponse=maker.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/versions/'+draft.id));
  await maker.getByRole('button',{name:'Save Draft'}).click();
  const savedResponse=await saveResponse,saved=await request(savedResponse),saveBody=savedResponse.request().postDataJSON();
  assert.equal(saved.calculationSha256,preview.calculationSha256);
  await maker.waitForFunction(()=>document.querySelector('#fin-impact-form input[name=value]')?.value==='21'&&
    document.querySelector('#fin-impact-status')?.textContent==='');
  await maker.reload();await field.waitFor();
  check('Business recorder saves real scoped data, digest matches and reopen shows 21 CNY per piece',await field.inputValue()==='21');
  const target=api(run.scenarios.p08)+'/versions/'+draft.id;
  const members=base+'/api/projects/'+run.scenarios.p08+'/members';
  const grant=groupId=>admin.request.patch(members,{data:{userUid:run.commercialUid,groupId}});
  const other=(await maker.request.get(api(run.scenarios.p12)+'/workspace')).status();
  try{
    await request(await grant('finance-reader'));
    const replay=(await maker.request.put(target,{data:saveBody})).status();
    await request(await admin.request.delete(members,{data:{userUid:run.commercialUid}}));
    const lostRead=(await maker.request.get(target)).status();
    roles.commercial={save:savedResponse.status(),other,afterDowngrade:replay,afterRemoval:lostRead};
    assert.deepEqual(roles.commercial,{save:200,other:404,afterDowngrade:403,afterRemoval:404});
  } finally {await request(await grant('finance-commercial'));}
  check('Downgrade and membership removal apply immediately to the same business session',true);

  const attachProject=run.scenarios.p08;
  const timing=await request(await admin.request.get(base+'/api/projects/'+attachProject+'/timing'));
  const bytes=Buffer.from('P14 synthetic review attachment, byte checked before and after recovery.\n');
  const upload=await request(await admin.request.post(base+'/api/projects/'+attachProject+'/tasks/'+timing.tasks[0].id+'/attachments',
    {data:bytes,headers:{'X-File-Name':'p14-recovery.txt','Content-Type':'application/octet-stream'}}));
  const article=await request(await admin.request.post(base+'/api/articles',{data:{title:'P14 Recovery Lesson',content:'Synthetic project knowledge for the recovery comparison.',projectId:attachProject}}));
  const downloaded=await admin.request.get(base+'/api/attachments/'+upload.id);assert.deepEqual(await downloaded.body(),bytes);
  check('Registered real synthetic task attachment, returned identical bytes, and stored a non-finance project lesson',!!article.id);
  await writeFile(join(run.directory,'recovery-controls.json'),JSON.stringify({attachProject,attachment:upload.id,article:article.id,commercialDraft:draft.id},null,2)+'\n');
  check('No uncaught browser scripts',errors.length===0);
  const copy=[['p09','desktop-t2-impact.png','desktop-me-impact.png'],['p10','desktop-t4-impact.png','desktop-development-impact.png'],
    ['p11','desktop-t5-receipt.png','desktop-delayed-recovery.png'],['p13','desktop-bridge.png','desktop-comparison.png']];
  for(const [step,original,name] of copy)await copyFile(join(workflowDir,step,original),join(evidence,name));
  const summaries=Object.fromEntries(Object.entries(workflows).map(([step,result])=>{
    const evidence=Array.isArray(result.checks)?result.checks:result.results;
    assert.ok(Array.isArray(evidence)&&evidence.length,step+' workflow has no recorded assertions');
    return [step,{checks:evidence.length,evidence,reconciliation:result.reconciliation??result.numbers??null}];
  }));
  // Persist only public synthetic examples, named worksheet coordinates and boolean assertions.
  await writeFile(join(evidence,'browser-checks.json'),JSON.stringify({step:'P14',browser:'Chrome',
    viewports:[[1440,1000],[390,844]],metrics:Object.keys(metricRoutes),routes,checks,roles,commercialImpact:numbers,workflows:summaries},null,2)+'\n');
  await writeFile(join(evidence,'glossary-checks.json'),JSON.stringify({step:'P14',allRenderedKeysHadChineseDefinitions:true,
    entryMethods:['mouse hover','keyboard Tab and Escape','touch tap and Close'],keys:[...terms].sort()},null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,workflows:Object.values(summaries).reduce((sum,row)=>sum+row.checks,0),metricKeys:terms.size}));
} finally {await browser.close();}
