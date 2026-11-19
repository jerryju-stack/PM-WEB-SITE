import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {httpFixture} from '../tests/http-fixture.ts';
import {mixedFxScenario} from '../tests/fixtures/finance-fx.ts';

const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const fixture=await httpFixture();
let browser;
try{
  const api=async(path,body,method,expected=200)=>{
    const response=await fixture.call(path,body,fixture.cookie,method);
    assert.equal(response.status,expected,JSON.stringify(response.data).slice(0,300));
    return response.data;
  };
  const project=(await api('projects',{title:'TEST · FX browser acceptance'},'POST')).id;
  const path='projects/'+project+'/finance',versions=path+'/versions';
  const a=(await api(versions,{requestKey:'browser-create',reason:'TEST · Synthetic rates',snapshot:mixedFxScenario()},'POST',201)).id;
  await api(versions+'/'+a+'/freeze',{requestKey:'browser-freeze',reason:'TEST baseline',revision:0,stateRevision:0});
  const b=(await api(versions,{requestKey:'browser-clone',reason:'TEST forecast',name:'TEST · Forecast B',parentId:a,parentRevision:1},'POST',201)).id;
  await api(versions+'/'+b+'/activate',{requestKey:'browser-activate',reason:'TEST forecast',revision:0,stateRevision:1});

  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--no-proxy-server']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const [name,value]=fixture.cookie.split('=');
  await context.addCookies([{name,value,url:fixture.base}]);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const pending=async(id,value)=>{
    const rendered=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/finance/workspace'));
    await page.locator(id).selectOption(value);
    assert.equal((await rendered).status(),200);
    await page.waitForFunction(({id,value})=>document.querySelector(id)?.value===value,{id,value});
  };
  const exportJson=async(id)=>{
    const ready=page.waitForEvent('download');
    await page.locator(id).click();
    const download=await ready;
    return JSON.parse(await readFile(await download.path(),'utf8'));
  };
  const card=(metric)=>page.locator('#metric-'+metric+'').locator('..');
  const contribution=page.locator('.fin-panel').filter({has:page.getByRole('heading',{name:/^Product contribution/})});
  const settings=page.locator('#fin-more-settings');
  const openSettings=async()=>{
    if(!await settings.evaluate(el=>el.open))await settings.locator(':scope > summary').click();
  };
  await page.goto(fixture.base+'/'+path);
  await card('operating_profit').waitFor();
  assert.equal(await page.locator('.fin-metric').count(),4);
  assert.equal(await page.locator('#fin-fx-settings').isVisible(),false);
  assert.equal(await page.locator('#fin-filter-baseline').isVisible(),false);
  assert.match(await contribution.innerText(),/300\.00 USD/);
  assert.match(await card('operating_profit').innerText(),/200\.00 USD/);
  assert.match(await contribution.innerText(),/40%/);
  await openSettings();
  await pending('#fin-display-currency','JPY');
  assert.match(await contribution.innerText(),/45,000 JPY/);
  assert.match(await card('operating_profit').innerText(),/30,000 JPY/);
  assert.match(await contribution.innerText(),/40%/);
  assert.match(await page.locator('.fin-chart canvas').getAttribute('aria-label'),/JPY/);
  const dashboard=await exportJson('#fin-export-dashboard');
  assert.equal(dashboard.displayCurrency,'JPY');
  assert.equal(dashboard.current.details.currency,'USD');
  assert.equal(dashboard.current.fxBasis.snapshot.rates.JPY,'150');
  assert.equal(dashboard.current.metrics.total_cost.displayValue,'45000');
  assert.equal(dashboard.current.budget.approved_budget.displayValue,'15000');
  assert.equal(dashboard.selection.metrics.total_cost.forecast.displayValue,'45000');
  assert.equal(dashboard.current.periodic[1].cash_flow.currency,'JPY');
  await pending('#fin-filter-period','year-0');
  const selectedPeriod=await exportJson('#fin-export-dashboard');
  assert.equal(selectedPeriod.selection.period,'year-0');
  assert.equal(selectedPeriod.selection.metrics.revenue.forecast.displayValue,'0');
  await pending('#fin-filter-period','');
  const source=await exportJson('#fin-export-snapshot');
  assert.equal(source.currency,'USD');
  assert.equal(source.inputs.find(row=>row.metricKey==='p08.part_price'&&row.currency==='JPY').value.coefficient,'15000000000000000');

  await page.locator('#fin-fx-settings summary').click();
  await page.locator('input[name="rate-EUR"]').fill('0.75');
  await page.locator('input[name="reason"]').fill('TEST · Revalue the European purchase');
  await page.getByRole('button',{name:'Preview rate changes'}).click();
  await page.getByText('Preview ready.',{exact:true}).waitFor();
  assert.match(await page.locator('[data-fx-preview]').innerText(),/180\.00 USD/);
  await page.getByRole('button',{name:'Save version rates'}).click();
  await page.getByText(/1 USD = 0\.75 EUR/).waitFor();
  assert.match(await card('operating_profit').innerText(),/27,000 JPY/);
  await page.reload();
  await card('operating_profit').waitFor();
  await openSettings();
  assert.match(await card('operating_profit').innerText(),/27,000 JPY/);
  const after=(await api(versions+'/'+b));
  assert.equal((await api(versions+'/'+a)).snapshot.policy.fx.rates.EUR,'0.90');

  await page.locator('.fin-tabs a').filter({hasText:'Version Comparison'}).click();
  const comparison=page.locator('.fin-panel').filter({has:page.getByRole('heading',{name:'Business change and FX impact',exact:true})});
  await comparison.waitFor();
  const profit=comparison.getByRole('row',{name:/^Operating Profit/}).filter({hasNotText:'Margin'});
  assert.match(await profit.innerText(),/−?\s*-?3,000 JPY.*0 JPY.*-3,000 JPY/s);
  await pending('#fin-compare-fxMode','a');
  const totals=page.locator('.fin-panel').filter({has:page.getByRole('heading',{name:'Version totals',exact:true})});
  const profitTotals=totals.getByRole('row',{name:/^Operating Profit/}).filter({hasNotText:'Margin'});
  assert.match(await profitTotals.innerText(),/30,000 JPY.*30,000 JPY.*0 JPY/s);
  await pending('#fin-compare-fxMode','b');
  assert.match(await profitTotals.innerText(),/27,000 JPY.*27,000 JPY.*0 JPY/s);
  const exported=await exportJson('#fin-export-comparison');
  assert.equal(exported.mode,'b');
  assert.equal(exported.currency,'JPY');
  assert.equal(exported.metrics.operating_profit.business.displayValue,'0');
  assert.equal(exported.metrics.operating_profit.fxImpact.displayValue,'-3000');
  assert.equal(exported.beforeBasis.snapshot.rates.EUR,'0.90');
  assert.equal(exported.afterBasis.snapshot.rates.EUR,'0.75');
  assert.deepEqual(await api(versions+'/'+b),after);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('Finance FX browser acceptance passed: dashboard, source and result exports, preview, save, reload, three comparison modes, read-only comparison and mobile overflow.');
}finally{
  await browser?.close();
  await fixture.stop();
}
