import {CalculationBuilder} from './finance-calculation-types.ts';
import type {Value,CalculationOutput} from './finance-calculation-types.ts';
import type {FinanceInput,FixedDecimal} from './finance-contracts.ts';
import {Decimal,ONE,ZERO,sum} from './finance-decimal.ts';
import {createBusinessCalculation} from './finance-business-calculation.ts';
import {createOperationsCalculation} from './finance-operations-calculation.ts';
import {createDevelopmentCalculation,developmentBudget} from './finance-development-calculation.ts';
import {capitalDiscount,createCapitalCalculation,createWorkingCapital} from './finance-capital-calculation.ts';
import {bridgeInput,bridgePeriodKey,cost} from './finance-bridge-inputs.ts';

/** P05 supplies frozen upstream schedules. Terminal P&L/cash caches are NEVER read here.
 * P08-P11 can replace the declared upstream schedules with their detailed business models.
 */
export function cqaCalculation(b:CalculationBuilder) {
  const s=b.snapshot,periods=[...s.periods].sort((a,c)=>Number(a.metadata.ordinal)-Number(c.metadata.ordinal));
  const business=createBusinessCalculation(b);
  const routeLabor=createOperationsCalculation(b);
  const development=createDevelopmentCalculation(b);
  const capital=createCapitalCalculation(b),workingCapital=createWorkingCapital(b);
  const byCell=new Map(s.sources.filter(r=>r.sheet&&r.cell).map(r=>[r.sheet+'!'+r.cell,r]));
  const bySource=new Map<string,FinanceInput[]>();for(const r of s.inputs){const a=bySource.get(r.sourceKey)??[];a.push(r);bySource.set(r.sourceKey,a);}
  function read(sheet:string,cell:string,period:string,unit='CNY',blankIsZero=false,allowOverride=true):Value {
    const source=byCell.get(sheet+'!'+cell),excel=source?.metadata.excel as any,id='source:'+(source?.key??sheet+'!'+cell)+':'+period+':'+unit+(allowOverride?'':':original');
    if(b.values.has(id))return b.values.get(id)!;
    let q:Decimal|null=null,role='P05 frozen upstream schedule; original precision',status:'ok'|'missing_input'='missing_input';
    if(source&&excel?.state==='number')try {q=Decimal.from(excel.value);status='ok';}catch{}
    if(source&&excel?.state==='blank'&&blankIsZero){q=ZERO;status='ok';role='P01 explicitly empty schedule cell: no activity';}
    const overrides=(source?bySource.get(source.key):[])?.filter(r=>(r.conversion.p06Overrides as any)?.[period]!==undefined)??[];
    if(allowOverride&&overrides.length) {
      if(overrides.length!==1)q=null;
      else {const row=overrides[0];q=Decimal.from((row.conversion.p06Overrides as Record<string,FixedDecimal>)[period]).div(Decimal.from(String(row.conversion.multiplier??'1')));role='P06 candidate/saved driver override';status='ok';}
    }
    return b.input({id,sourceKey:source?.key??null,inputKey:overrides[0]?.key??bySource.get(source?.key??'')?.[0]?.key??null,role,unit,currency:unit.includes('CNY')?'CNY':null,periods:[period],value:q?.text()??null,status:q===null?'missing_input':status,sheet,cell},q);
  }
  const products:Record<string,{periodic:Record<string,Value>[]}>={};
  const projectRate=read('Exec Sum ','C182',periods[0].key,'fraction');
  let rate=projectRate;
  if(rate.q&&rate.q.cmp(Decimal.from(-1))<=0)rate=b.make('project:discount_rate','discount_rate',null,[rate],{status:'invalid_rate',unit:'fraction',details:{message:'Annual discount rate must exceed -100%.'}});
  const knownRates=s.products.filter(p=>p.metadata.active!==false).map(p=>read(String(p.metadata.externalKey),'C330',periods[0].key,'fraction'));
  if(knownRates.some(r=>!r.q)||knownRates.some(r=>r.q&&projectRate.q&&r.q.sub(projectRate.q).abs().cmp(Decimal.from('0.00000001'))>0))
    rate=b.make('project:discount_rate','discount_rate',null,[projectRate,...knownRates],{status:'missing_input',unit:'fraction',details:{message:'Project and product discount-rate assumptions are missing or inconsistent.'}});
  for(const product of s.products.filter(p=>p.metadata.active!==false)) {
    const sheet=String(product.metadata.externalKey),rows:Record<string,Value>[]=[],scope=[product.key];
    for(const [t,period] of periods.entries()) {
      const col=String.fromCharCode(68+t),p=period.key,prefix=product.key+':'+p,record:Record<string,Value>={};
      const raw=(cell:string,unit='CNY',blank=false,override=true)=>read(sheet,cell,p,unit,blank,override);
      const def=(key:string,deps:Value[],fn:(a:Decimal[])=>Decimal,extra:Partial<CalculationOutput>={})=>{
        const v=b.calc(prefix+':'+key,key,deps,fn,{basis:'cqa_incremental',currency:'CNY',unit:'CNY',periods:[p],productScope:scope,...extra});record[key]=v;return v;
      };
      const scaled=(cell:string,blank=false)=>b.calc(prefix+':schedule:'+cell,'schedule',[raw(cell,'thousand CNY',blank)],([v])=>v.mul(Decimal.from(1000)),{currency:'CNY',unit:'CNY',periods:[p],productScope:scope,formula:'P05 original precision schedule × 1000'});
      const model=business?.(product.key,p,t,def,raw);
      const volume=model?.volume??def('volume',[raw(col+'183','thousand pieces',t===0)],([v])=>{
        const n=v.mul(Decimal.from(1000)),whole=Decimal.from(n.text(0));if(n.sub(whole).abs().cmp(Decimal.from('0.0000001'))>0)throw new Error('Volume cannot be restored to whole pieces under P01.');return whole;
      },{unit:'pieces',currency:null,basis:'cqa_full'});
      const unit=(key:string,row:number)=>def(key,volume.q?.n===0n?[volume]:[raw(col+row,'CNY/piece')],([v])=>volume.q?.n===0n?ZERO:v,{unit:'CNY/piece',basis:'cqa_full'});
      const price=model?.price??unit('unit_sales',94),materialUnit=model?.material??unit('unit_material',99);
      const vohUnit=model?.factoryCost('variable')??unit('unit_voh',107);
      const fixedOverride=model?.factoryCost('fixed');
      const fohUnit=fixedOverride??(model?.repriceFactory?def('unit_foh',[unit('archive_unit_foh',108),price,unit('archive_unit_sales',94),read('Input','C16',p,'fraction')],
        ([origin,quote,originalQuote,rate])=>origin.add(quote.sub(originalQuote).mul(rate)),{unit:'CNY/piece',basis:'cqa_full'}):unit('unit_foh',108));
      for(const part of model?.partCosts??[])record[part.out.id]=part;
      // Recompute both AME-linked operations. Labor efficiency is distinct from equipment OEE.
      record.volume=volume;
      const detailed=routeLabor(product.key,p,volume),operations:Value[]=[];
      if(detailed)operations.push(detailed);
      if(!detailed)for(const first of [594,599]) {
        const staffSource=byCell.get(sheet+'!C'+first),ctSource=byCell.get(sheet+'!C'+(first+1));
        const staffFormula=(staffSource?.metadata.excel as any)?.formula??'',ctFormula=(ctSource?.metadata.excel as any)?.formula??'';
        const staffRef=/AME!\$?E\$?(\d+)/.exec(staffFormula),ctRef=/AME!\$?F\$?(\d+)/.exec(ctFormula);
        const people=staffRef?read('AME','E'+staffRef[1],p,'persons'):raw('C'+first,'persons');
        const ct=ctRef?read('AME','F'+ctRef[1],p,'seconds/cycle'):raw('C'+(first+1),'seconds/piece');
        const efficiency=raw('D'+first,'fraction'),allowance=raw('D'+(first+1),'fraction',true),hourly=raw('D590','CNY/person-hour');
        const hours=([a,c,e,l]:Decimal[])=>a.mul(c).mul(Decimal.from(ctRef?Number(product.metadata.cyclesPerUnit):1))
          .div(Decimal.from(3600)).mul(e.n>0n?ONE.div(e):ONE.add(l));
        const operation=def('operation_'+first,[people,ct,efficiency,allowance,hourly],([a,c,e,l,h])=>{
          if(a.n<0n||c.n<0n||h.n<0n||e.n<0n||e.cmp(ONE)>0)throw new Error('Invalid labor assumption.');
          return hours([a,c,e,l]).mul(h);
        },{unit:'CNY/piece',basis:'cqa_full',formula:'people × CT × cycles per piece × hourly rate / 3600; CQA efficiency or allowance'});
        operations.push(operation);
        if(b.bridge&&operation.q)b.bridge.labor.set(operation,{quantity:hours([people.q!,ct.q!,efficiency.q!,allowance.q!]),rate:hourly.q});
      }
      const otherLabor=[606,611,616,621,626,631,636,638].map(r=>raw('C'+r,'CNY/piece',true));
      const sopLabor=def('unit_labor_sop',[...operations,...otherLabor],sum,{unit:'CNY/piece',basis:'cqa_full'});
      const archiveSop=volume.q?.n===0n?null:raw('C640','CNY/piece',false,false);
      const archiveAnnual=volume.q?.n===0n?null:raw(col+'102','CNY/piece',false,false);
      const laborUnit=volume.q?.n===0n?def('unit_labor',[volume],()=>ZERO,{unit:'CNY/piece',basis:'cqa_full'}):
        def('unit_labor',[sopLabor,archiveSop!,archiveAnnual!],([next,base,annual])=>{
          if(base.n===0n){if(next.n===0n&&annual.n===0n)return ZERO;throw new Error('zero_denominator');}return annual.mul(next).div(base);
        },{unit:'CNY/piece',basis:'cqa_full',formula:'recomputed SOP labor × frozen annual productivity/rate schedule (annual labor / archived SOP labor)'});
      const salesFactor=raw('K447','fraction'),costFactor=raw('K448','fraction');
      const revenue=def('revenue',[volume,price,salesFactor],([v,u,f])=>v.mul(u).mul(ONE.add(f)),{basis:'cqa_full'});
      const material=def('material',[volume,materialUnit,costFactor],([v,u,f])=>v.mul(u).mul(ONE.add(f)),{basis:'cqa_full'});
      const labor=def('labor',[volume,laborUnit,costFactor],([v,u,f])=>v.mul(u).mul(ONE.add(f)),{basis:'cqa_full'});
      const scrap=def('scrap',[volume,price,...(t?[model?.factoryCost('scrap')??raw(col+'418','fraction')]:[])],a=>t?a[0].mul(a[1]).mul(a[2]):ZERO,{basis:'cqa_full'});
      const voh=def('voh',[volume,vohUnit],([v,u])=>v.mul(u),{basis:'cqa_full'}),foh=def('foh',[volume,fohUnit],([v,u])=>v.mul(u),{basis:'cqa_full'});
      const gross=def('gross_investment',[294,295,296,297,298,299,300].map(r=>scaled(col+r,true)),sum);
      const recovery=def('investment_recovery',[scaled(col+'430',true)],([v])=>v);
      const investment=capital(product.key,p,t,volume,def,{gross,receipt:recovery});
      const depreciation=def('depreciation',[scaled(col+'195',t===0),investment.dep],sum,{basis:'cqa_full'});
      const incrementalDep=def('incremental_depreciation',[...(volume.q?.n===0n?[volume]:[scaled(col+'313')]),investment.incrementalDep],sum);
      const warranty=model?.factoryCost('warranty'),pack=model?.factoryCost('packaging');
      const repriced=!!model?.repriceFactory;
      const warrantyCost=warranty||repriced?def('factory_warranty',[price,volume,warranty??raw(col+'424','fraction')],([u,v,r])=>u.mul(v).mul(r)):scaled(col+'197',t===0);
      const freight=pack||repriced?def('factory_packaging',[volume,...(pack?[pack]:[raw(col+'421','CNY/piece'),raw(col+'422','CNY/piece')])],
        ([v,...rates])=>v.mul(sum(rates))):scaled(col+'198',t===0);
      const otherTax=repriced?def('factory_other',[volume,raw(col+'423','CNY/piece')],([v,r])=>v.mul(r)):scaled(col+'199',t===0);
      const launch=model?.factoryCost('launch')??scaled(col+'200',t===0);
      const otherFixed=scaled(col+'201',t===0);
      const other=def('other_costs',[warrantyCost,freight,otherTax,launch,otherFixed],sum,{basis:'cqa_full',
        formula:repriced||warranty||pack||model?.factoryCost('launch')?'Warranty + packaging and freight + other factory costs + launch':'frozen P05 freight, warranty, other factory and launch schedules'});
      const allocations=def('allocations',[model?.factoryCost('allocation')??scaled(col+'209',t===0)],([v])=>v,{basis:'cqa_full'});
      const dev=development(product.key,p,volume,def);
      const archiveEngineering=scaled(col+'426'),archiveRecovery=scaled(col+'427',true);
      const engineering=def('engineering_budget',[archiveEngineering,dev.gross],sum);
      const engineeringRecovery=def('engineering_recovery',[archiveRecovery,dev.recovery],sum);
      const netEngineering=def('net_engineering',[engineering,engineeringRecovery],([a,c])=>a.sub(c));
      Object.assign(record,developmentBudget(b,prefix,p,engineering,scope,product.key));
      const fullCost=def('full_cost',[material,labor,scrap,voh,foh,depreciation,other,allocations,netEngineering],sum,{basis:'cqa_full'});
      const earnedRevenue=def('earned_revenue',[revenue,investment.piece],sum,{basis:'cqa_full'});
      const factoryProfit=def('factory_profit',[earnedRevenue,fullCost,allocations,netEngineering],([r,c,a,e])=>r.sub(c).add(a).add(e),{basis:'cqa_full'});
      def('mpbitri',[factoryProfit,allocations,netEngineering],([r,a,e])=>r.sub(a).sub(e),{basis:'cqa_full'});
      const totalCost=def('incremental_total_cost',[material,labor,scrap,voh,foh,incrementalDep,other,netEngineering],sum);
      const cbt=def('cbt',[earnedRevenue,totalCost],([r,c])=>r.sub(c));
      def('incremental_profit',[cbt],([v])=>v);
      const wc=workingCapital(product.key,p,t,revenue,material,cbt,def,{inventory:raw('D446','days'),receivable:raw('D447','days'),
        payable:raw('D448','days'),tax:raw('C329','fraction')});
      def('net_investment',[record.capital_net],([v])=>v);
      def('investment_cash',[investment.cash],([v])=>v);
      const developmentCashAdjustment=def('development_cash_timing',[dev.gross,dev.recovery,dev.cash],([gross,recovery,cash])=>gross.sub(recovery).add(cash));
      const cash=def('cash_flow_cny',[cbt,incrementalDep,wc.tax,wc.change,investment.cash,developmentCashAdjustment,investment.pieceCash,investment.piece],
        values=>sum(values.slice(0,-1)).sub(values.at(-1)!),{formula:'CBT + depreciation + tax + NWC + net capital cash + settlement timing'});
      const fx=def('usd_per_cny',[read('Input','C8',p,'CNY/USD')],([v])=>ONE.div(v),{unit:'USD/CNY',currency:null});
      const usd=def('cash_flow_usd',[cash,fx],([c,r])=>c.mul(r),{currency:'USD',unit:'USD'});
      def('cash_flow',[s.currency==='USD'?usd:cash],([v])=>v,{currency:s.currency,unit:s.currency});
      def('reported_revenue',s.currency==='USD'?[earnedRevenue,fx]:[earnedRevenue],a=>a.length===2?a[0].mul(a[1]):a[0],{currency:s.currency,unit:s.currency,basis:'cqa_full'});
      def('reported_profit',s.currency==='USD'?[record.mpbitri,fx]:[record.mpbitri],a=>a.length===2?a[0].mul(a[1]):a[0],{currency:s.currency,unit:s.currency,basis:'cqa_full'});
      if(b.bridge){
        const laborScale=volume.q?.n===0n?ZERO:archiveSop?.q&&archiveSop.q.n===0n&&labor.q?.n===0n?ZERO:
          volume.q&&archiveSop?.q?.n&&archiveAnnual?.q&&costFactor.q?
            volume.q.mul(archiveAnnual.q).div(archiveSop.q).mul(ONE.add(costFactor.q)):null;
        const operatingTerms=[
          bridgeInput('sales',revenue,{factorKind:'sales',factor:{quantity:volume.q,rate:price.q&&salesFactor.q?price.q.mul(ONE.add(salesFactor.q)):null}}),
          cost('material',material),...(laborScale?.n===0n?[cost('labor',labor)]:
            b.bridge.laborTerms(operations,otherLabor,laborScale,[volume,costFactor,...(archiveSop&&archiveAnnual?[archiveSop,archiveAnnual]:[])])),
          cost('factory_scrap',scrap),cost('factory_variable',voh),cost('factory_fixed',foh),
          cost('factory_warranty',warrantyCost),cost('factory_packaging',freight),cost('factory_launch',launch),
          cost('factory_other',otherTax),cost('factory_other',otherFixed),
          cost('archive_engineering',archiveEngineering),bridgeInput('archive_engineering',archiveRecovery)
        ];
        b.bridge.periods.set(bridgePeriodKey(product.key,p),{
          profit:[...operatingTerms,...dev.profitTerms,cost('depreciation',depreciation),cost('factory_allocation',allocations),
            bridgeInput('piece_recovery',investment.piece)],
          cash:[...operatingTerms,...dev.cashTerms,...investment.cashTerms,bridgeInput('tax',wc.tax),bridgeInput('working_capital',wc.change)],
          ...(s.currency==='USD'?{fx}:{})
        });
      }
      rows.push(record);
    }
    products[product.key]={periodic:rows};
  }
  return {products,rate:capitalDiscount(b,rate)};
}
