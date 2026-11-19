import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {httpFixture} from '../tests/http-fixture.ts';
import {p08Scenario} from '../tests/fixtures/finance-p08.ts';

const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const fixture=await httpFixture();
let browser;
try{
  const create=await fixture.call('projects',{title:'TEST · Finance glossary'},fixture.cookie);
  assert.equal(create.status,200);
  const path='projects/'+create.data.id+'/finance';
  const versions=path+'/versions';
  const draft=await fixture.call(versions,{requestKey:'glossary-create',reason:'Synthetic glossary check',snapshot:p08Scenario()},fixture.cookie);
  assert.equal(draft.status,201);
  const frozen=await fixture.call(versions+'/'+draft.data.id+'/freeze',{
    requestKey:'glossary-freeze',reason:'Synthetic glossary check',revision:0,stateRevision:0
  },fixture.cookie);
  assert.equal(frozen.status,200);

  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--no-proxy-server']});
  const errors=[];
  async function dashboard(mobile=false){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile});
    const [name,value]=fixture.cookie.split('=');
    await context.addCookies([{name,value,url:fixture.base}]);
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.base+'/'+path);
    await page.locator('#metric-revenue').waitFor();
    return page;
  }
  const desktop=await dashboard();
  const revenue=desktop.locator('[data-definition="revenue"]').first();
  const profit=desktop.locator('[data-definition="operating_profit"]').first();
  const definition=desktop.locator('#fin-definition');
  const close=definition.getByRole('button',{name:'Close'});
  await revenue.hover();
  assert.equal(await definition.getAttribute('role'),'tooltip');
  assert.match(await definition.innerText(),/营业收入/);
  assert.equal(await close.count(),0);
  assert.equal(await revenue.getAttribute('aria-describedby'),'fin-definition');
  await desktop.mouse.move(0,0);
  await definition.waitFor({state:'detached'});
  assert.equal(await revenue.getAttribute('aria-describedby'),null);

  await revenue.hover();
  await revenue.click();
  await profit.hover();
  assert.equal(await definition.getAttribute('role'),'region');
  assert.match(await definition.innerText(),/营业收入/);
  assert.equal(await revenue.getAttribute('aria-expanded'),'true');
  await desktop.locator('#finance-workspace h1').click();
  assert.equal(await definition.getAttribute('role'),'region');
  await close.click();
  await definition.waitFor({state:'detached'});
  assert.equal(await revenue.getAttribute('aria-expanded'),'false');
  assert.ok(await revenue.evaluate(button=>button===document.activeElement));

  await desktop.mouse.move(0,0);
  await desktop.locator('#metric-operating_profit').focus();
  await desktop.keyboard.press('Tab');
  assert.ok(await profit.evaluate(button=>button===document.activeElement));
  assert.match(await definition.innerText(),/经营利润/);
  await desktop.keyboard.press('Shift+Tab');
  await definition.waitFor({state:'detached'});
  await desktop.keyboard.press('Tab');
  await desktop.keyboard.press('Enter');
  assert.equal(await definition.getAttribute('role'),'region');
  assert.ok(await close.evaluate(button=>button===document.activeElement));
  await desktop.keyboard.press('Escape');
  await definition.waitFor({state:'detached'});
  assert.ok(await profit.evaluate(button=>button===document.activeElement));

  const mobile=await dashboard(true);
  const mobileRevenue=mobile.locator('[data-definition="revenue"]').first();
  const mobileDefinition=mobile.getByRole('region',{name:'Revenue',exact:true});
  await mobileRevenue.tap();
  assert.match(await mobileDefinition.innerText(),/营业收入/);
  await mobileDefinition.getByRole('button',{name:'Close'}).tap();
  await mobileDefinition.waitFor({state:'detached'});
  assert.ok(await mobileRevenue.evaluate(button=>button===document.activeElement));
  assert.deepEqual(errors,[]);
  console.log('Finance glossary browser acceptance passed: mouse preview, click details, keyboard and touch.');
}finally{
  await browser?.close();
  await fixture.stop();
}
