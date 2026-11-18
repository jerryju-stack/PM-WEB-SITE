import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {definition,groups,budgetKeys} from '../src/finance-view.ts';
import type {Dictionary} from '../src/finance-view.ts';
import {businessFields} from '../lib/finance-business.ts';
import {bridgeDrivers} from '../lib/finance-bridges.ts';
import {capitalMetrics,capitalLifetime} from '../lib/finance-capital-calculation.ts';
import {developmentMetrics} from '../lib/finance-development-calculation.ts';
import {cqaDrivers,websiteDrivers} from '../lib/finance-preview.ts';

const directory='docs/validation/project-finance';
const dictionary=JSON.parse(readFileSync(directory+'/P01/metric-dictionary.json','utf8')) as Dictionary;
const browser=JSON.parse(readFileSync(directory+'/P14/glossary-checks.json','utf8'));
assert.equal(browser.allRenderedKeysHadChineseDefinitions,true);
const used=new Set<string>([
  ...browser.keys,...groups.flatMap(group=>group.keys),...budgetKeys,...websiteDrivers,...cqaDrivers,
  ...Object.keys(businessFields).map(key=>'p08.'+key),...Object.keys(bridgeDrivers),...capitalMetrics,...capitalLifetime,...developmentMetrics,
  'recorded_payments','draft_cost','unpaid_confirmed','etc_consumed','reported_profit','reported_revenue','display_rounding',
  'cqa.mpbitri_margin','voh','foh','other_costs','unit_material','unit_labor','weighted_material','landed_contribution'
]);
const viewFiles=['finance','finance-compare','finance-view','finance-operations','finance-impact','finance-budget','finance-capital','finance-development'];
for(const view of viewFiles){
  const source=readFileSync('src/'+view+'.ts','utf8');
  for(const match of source.matchAll(/(?:help|metricLabel|nameOf)\((?:dictionary|glossary),'([a-z_.0-9]+)'\)/g))used.add(match[1]);
}
const keys=[...used].sort();
for(const key of keys){
  const item=definition(dictionary,key);
  assert.ok(item?.en?.trim()&&item.zh.trim()&&/\p{Script=Han}/u.test(item.zh)&&/\p{Script=Han}/u.test(item.definition),key);
}
writeFileSync(directory+'/P14/glossary-checks.json',JSON.stringify({...browser,contractKeys:keys,contractCount:keys.length,
  unresolvedKeys:[]},null,2)+'\n');
console.log(JSON.stringify({browser:browser.keys.length,contract:keys.length,unresolved:0}));
