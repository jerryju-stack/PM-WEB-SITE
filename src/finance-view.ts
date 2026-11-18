import type {financeService} from '../lib/finance.ts';
import type {CalculationOutput, InputEvidence} from '../lib/finance-calculation-types.ts';

export type Workspace=ReturnType<ReturnType<typeof financeService>['workspace']>;
export type FinanceReport=NonNullable<Workspace['current']>;
export type FinanceDriver=Workspace['inputs'][number];
export type Dictionary={metrics:Record<string,{zh:string;en:string;definition:string;formula?:string}>};
export type FinanceAmount=Pick<CalculationOutput,'displayValue'|'value'|'unit'>&{status:string};
export type FinanceLink=(route?:string)=>string;

export const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
export const modules=[
  ['commercial','Commercial & Volume','P08'],['bom','BOM & Purchasing','P08'],
  ['operations','Manufacturing & Labor','P09'],['factory-costs','Factory Costs & Launch','P08'],
  ['engineering','Engineering & PM Hours','P10'],['prototypes','Prototypes & Builds','P10'],
  ['validation','Validation & Certification','P10'],['investment','Equipment & Investment','P11'],
  ['returns','Working Capital & Returns','P11'],['budget','Budget & Versions','P12']
];
export const reports=[['','Dashboard'],['budget','Budget Execution'],['returns','Project Returns'],['compare','Version Comparison']];
export const titleFor=(section:string)=>reports.find(([key])=>key===section)?.[1]??modules.find(([key])=>key===section)?.[1]??'Dashboard';
export const groups=[
  {keys:['revenue'],title:'Revenue',route:'commercial'},
  {keys:['operating_profit','operating_margin'],title:'Operating Profit / Margin',route:'operations'},
  {keys:['npv'],title:'NPV',route:'returns'},
  {keys:['irr'],title:'IRR',route:'returns'},
  {keys:['payback_period'],title:'Payback Period',route:'returns'},
  {keys:['peak_funding_requirement'],title:'Peak Funding Requirement',route:'returns'}
];
export const budgetKeys=['approved_budget','confirmed_actual','etc','eac','budget_balance','completion_variance'];
const supplemental:Dictionary['metrics']={
  volume:{en:"Volume",zh:"销量",definition:"当期计入项目预测的产品件数，按市场需求、配置率和单车用量折算为整件。"},
  reported_profit:{en:"Reported Profit",zh:"列示利润",definition:"按当前版本的全成本经营口径列示的逐期利润。历史 CQA 使用原表 MPBITRI。"},
  cash_flow:{en:"Period Cash Flow",zh:"当期现金流",definition:"该期项目现金流入减现金流出，包含适用的投资、回款、营运资金和税。"},
  cash_adjustment:{en:"Other cash adjustments",zh:"其他现金调整",definition:"显式写入本期间的独立现金额，已另行建模的款项不应重复纳入。"},
  other_cost:{en:"Other operating costs",zh:"其他经营成本",definition:"原生模型未在其他费用科目分列的期间经营成本。"},
  other_costs:{en:"Other factory costs",zh:"其他工厂费用",definition:"历史工厂费用组合，包含质保、包装运输、投产和其余按期费用。"},
  scrap:{en:'Scrap expense',zh:'废品费用',definition:'以适用的当期销售额和废品费率计提，以项目金额列示。'},
  factory_warranty:{en:'Warranty expense',zh:'质保费用',definition:'适用销售额与质保费率的乘积，或历史归档的当期质保金额。'},
  voh:{en:"Variable factory overhead",zh:"变动制造费用",definition:"按产品计费件数乘以适用的单位变动制造费用。"},
  foh:{en:"Fixed factory overhead",zh:"固定制造费用",definition:"当期归属产品的固定制造费用。CQA 历史口径以件数乘已分摊的单位费用。"},
  units_per_cycle:{en:"Units per cycle",zh:"每循环产出",definition:"一次标准作业循环可产出的产品件数，用来将作业时长换算成单件时长。"},
  cycles_per_unit:{en:"Repeats per piece",zh:"每件循环次数",definition:"完成一个产品需要该工序执行的循环次数。"},
  person_hours_per_piece:{en:"Person-hours per good piece",zh:"单位良品人时",definition:"设计采用标准工时并修正独立人工效率。实测采用批次实际直接人时除以良品数。"},
  bottleneck_load:{en:"Bottleneck load",zh:"瓶颈负荷",definition:"同一条生产线中每件耗时最高的工位时长。缺测时保留不可计算状态。"},
  measured_capacity_factor:{en:"Measured availability × quality",zh:"实测可用率乘良品率",definition:"实测周期已反映运行速度，产能只再乘可用率和良品率。"},
  allocated_line_share:{en:"Allocated line share",zh:"产线分配份额",definition:"某产品可使用的物理产线净排产时间比例。共线产品分配需满足总量限制。"},
  operation_labor:{en:"Operation labor",zh:"工序人工",definition:"工序标准或实测的计费人时乘人工费率，折算至每件产品。"},
  unit_labor_sop:{en:"SOP direct labor per piece",zh:"投产基准单件人工",definition:"以导入的投产工序、人数、CT、费率和原表其他人工为基准汇总的单位人工。"},
  market_quote:{en:"Effective market selling price",zh:"市场生效售价",definition:"按市场采用直接报价，或用前一期有效单价应用本期年降后的售价。"},
  market_volume:{en:"Market volume",zh:"市场销量",definition:"市场需求乘配置率与单车用量得到的产品件数。"},
  market_material:{en:"Market material cost",zh:"市场单位材料成本",definition:"适用市场内各物料的单位落地金额及历史材料曲线调整。"},
  weighted_material:{en:"Weighted material cost",zh:"加权单位材料成本",definition:"按市场销量权重汇总的单件材料金额。"},
  part_delta:{en:"Landed cost adjustment",zh:"物料落地成本变动",definition:"修订报价或用量产生的单件落地差额，沿原档材料变化因子递推。"},
  factory_operating_cash:{en:"Factory operating cash before adjustments",zh:"调整前工厂经营现金",definition:"收入扣除材料、人工和工厂现金费用，随后再计入税、营运资金和独立现金支出。"},
  profit:{en:"Full-cost profit",zh:"全成本利润",definition:"工厂经营收益扣除开发、折旧和适用分摊，加入确认的件价摊回。"},
  full_cost:{en:"Full costs",zh:"全成本",definition:"原表将材料、人工、工厂费用、全成本折旧、分摊及净开发费用合计。"},
  incremental_total_cost:{en:"Incremental total costs",zh:"增量总成本",definition:"原表增量税前贡献采用的材料、人工、厂费、增量折旧和其他适用费用合计。"},
  earned_revenue:{en:"Earned revenue",zh:"确认收入",definition:"当期产品收入与独立确认的件价摊回之和。"},
  allocations:{en:"Division allocations",zh:"事业部分摊",definition:"用于全成本利润的内部费用分摊，在增量现金中单独排除。"},
  engineering_budget:{en:"Archived engineering amount",zh:"归档工程投入",definition:"原 CQA 工程分期金额与已单独计入的详细开发发生额合计。"},
  engineering_recovery:{en:"Engineering recovery",zh:"工程补偿",definition:"原表计划工程补偿加已单独建模的开发补偿确认额。"},
  development_cash_timing:{en:"Development cash adjustments",zh:"开发现金时点调整",definition:"发生口径与实际或预计收付款口径的差异，用于将开发费用还原为现金。"},
  development_open_payment:{en:"Forecast balance payable",zh:"预计待付余额",definition:"费用应付额扣除已记录实际付款后的非负余额。"},
  development_open_receipt:{en:"Forecast balance to collect",zh:"预计待收余额",definition:"补偿计划金额扣除实际收款后的非负余额。"},
  development_piece_recovery:{en:"Development piece-price recovery",zh:"开发件价回收",definition:"合格产品销量乘每件独立的开发补偿价格。"},
  capital_basis:{en:"Asset cost basis",zh:"资产计价基础",definition:"采购金额或关联模具报价，按项目币种折算后计入资产。"},
  capital_cash_event:{en:"Capital settlement",zh:"资本收付款",definition:"按资本付款、客户回款或残值兑现凭据在相应期间计入现金。"},
  capital_cash:{en:"Capital cash flow",zh:"资本现金流",definition:"已排期一次性回款与残值现金减资本付款。"},
  capital_depreciation:{en:"Detailed full-cost depreciation",zh:"明细全成本折旧",definition:"详细资产按启用期、摊销年限、残值及产品分摊计算的全成本折旧。"},
  capital_incremental_dep:{en:"Detailed incremental depreciation",zh:"明细增量折旧",definition:"详细资产中仅新增资产计入本项目的折旧。"},
  piece_recovery_accrual:{en:"Piece-price recovery accrual",zh:"件价回收确认额",definition:"销量乘独立件价，在可采用期间内累计不超过合同限额。"},
  usd_per_cny:{en:"USD per CNY",zh:"每人民币折美元",definition:"以授权档案 Input 汇率将当期人民币金额折美元。"},
  schedule:{en:"Source schedule",zh:"来源分期额",definition:"由已归档的期间计划和原表单位折算得到的金额。"},
  cqa_source_metric:{en:"Archived control",zh:"归档控制值",definition:"来自授权工作簿的单元格、控制量或归档校核项，原值和单位以来源为准。"},
  sales_volume:{en:"Sales volume / mix",zh:"销量及销售组合影响",definition:"销量变化以原有效售价计算。销量及加权价格反映市场组合变化。"},
  sales_rate:{en:"Selling price / annual reduction",zh:"售价及年降影响",definition:"以原销量乘生效售价变化，将涨价或年降对收入的影响单列。"},
  sales_joint:{en:"Volume × price interaction",zh:"销量与售价共同影响",definition:"销量差乘售价差得到的交互金额。"},
  sales:{en:"Other sales effects",zh:"其他销售影响",definition:"有效销量和售价可拆项之外仍由销售收入变动产生的金额。"},
  labor_volume:{en:"Manufacturing person-hours",zh:"制造人时影响",definition:"制造计费人时变化乘原人工费率。"},
  labor_rate:{en:"Manufacturing hourly rate",zh:"制造人工费率影响",definition:"原制造计费人时乘人工费率变化。"},
  labor_joint:{en:"Manufacturing hours × rate interaction",zh:"制造人时与费率共同影响",definition:"计费人时差与人工费率差的乘积，按成本方向列示。"},
  engineering_volume:{en:"Engineering hours",zh:"工程工时影响",definition:"工程计费工时变化按原费率计算，包含合规产品分摊。"},
  engineering_rate:{en:"Engineering hourly rate",zh:"工程费率影响",definition:"以原分摊工时乘费率变化计算工程成本影响。"},
  engineering_joint:{en:"Engineering hours × rate interaction",zh:"工程工时与费率共同影响",definition:"工时差和费率差的乘积，按成本方向列示。"},
  engineering:{en:"Other engineering / PM costs and recovery",zh:"其他工程及项目管理费用",definition:"工程工时与费率分解之外的差旅、开发成本、补偿和未成对影响。"},
  prototypes:{en:"Prototype batches",zh:"样机批次费用",definition:"未被试验包覆盖的样机批次及相关加工、人工、运输等费用。"},
  validation:{en:"Validation and certification",zh:"试验验证及认证费用",definition:"项目审批范围内的试验包、验收、认证及复测影响。费用覆盖扣除重复计费。"},
  working_capital:{en:"Working capital",zh:"营运资金现金影响",definition:"期初与期末营运资金余额之间的变化所产生的现金影响。"},
  tax:{en:"Cash tax",zh:"现金税影响",definition:"所选税基、税率与发生期间形成的项目现金税差额。"},
  cash_series:{en:"Explicit cash flows",zh:"录入的现金序列",definition:"纯现金模型按期间直接提供的项目现金流变化。"},
  timing:{en:"Cash timing on the same source",zh:"同一来源的现金移期",definition:"在同一产品和单据下匹配异期反向金额，计量付款或收款时点的折现影响。"},
  fx:{en:"Reporting FX",zh:"报告汇率影响",definition:"用修订后的原币金额乘新旧报告币种的折算差。"},
  discount:{en:"Discount rate",zh:"折现率影响",definition:"以修订后现金流乘新旧折现因子的差额，单列折现假设变化。"},
  residual:{en:"Unexplained residual",zh:"未解释残差",definition:"版本总差扣除所有已归因的精确金额后仍剩余的部分。"},
  display_rounding:{en:"Display rounding",zh:"显示舍入差",definition:"币种精度下各行舍入金额合计与以完整精度计算后舍入的总差之间的差异。"},
  'p08.vehicles':{en:'Vehicle demand',zh:'车辆需求',definition:'所选市场和期间预计生产的车辆数。'},
  'p08.configuration':{en:'Configuration rate',zh:'配置率',definition:'使用本项目产品的车辆比例。'},
  'p08.units_per_vehicle':{en:'Units per vehicle',zh:'单车用量',definition:'装配本产品的每辆车所需数量。'},
  'p08.sales_price':{en:'Selling price',zh:'售价',definition:'该市场的单件售价，计算时按版本汇率转换。'},
  'p08.annual_reduction':{en:'Annual price reduction',zh:'年降',definition:'相对上一年度有效报价的降幅，输入比例小数。'},
  'p08.part_quantity':{en:'Quantity per product',zh:'零件用量',definition:'装配一件产品消耗的该零件数量。'},
  'p08.part_price':{en:'Supplier unit price',zh:'供应商单价',definition:'供应商以报价币种提供的单件零件价格。'},
  'p08.landed_adjustment':{en:'Landed adjustment per part',zh:'单件落地调整',definition:'货币换算后，每个零件归属的运费、关税及其他落地调整。'},
  landed_contribution:{en:'Landed contribution',zh:'单产品落地贡献',definition:'零件用量乘以折算报价与单件落地调整之和。'},
  unit_material:{en:'Material cost per product',zh:'单件材料成本',definition:'各零件落地贡献汇总，按市场有效销量加权。'},
  unit_sales:{en:'Selling price per product',zh:'单件售价',definition:'按市场有效销量加权后得到的单件售价。'},
  material:{en:'Direct material cost',zh:'直接材料费',definition:'所选期间单件材料成本乘以数量，并使用适用的历史系数。'},
  factory_profit:{en:'Factory profit',zh:'工厂利润',definition:'收入扣除工厂发生的经营费用，事业部分摊独立显示。'},
  'p08.tooling':{en:'Supplier tooling',zh:'供应商模具',definition:'一次性资本项，使用稳定资产号交给设备与投资模块。'},
  'p08.variable':{en:'Variable manufacturing overhead',zh:'变动制造费用',definition:'按产量计入的单位制造费用。'},
  'p08.fixed':{en:'Fixed manufacturing overhead',zh:'固定制造费用',definition:'期间固定成本。CQA 历史表保留已分摊到单位的费率。'},
  'p08.scrap':{en:'Scrap rate',zh:'废品费率',definition:'该期间按销售价值计提废品费用的比率。'},
  'p08.warranty':{en:'Warranty rate',zh:'质保费率',definition:'该期间按销售价值计提质保费用的比率。'},
  'p08.packaging':{en:'Packaging and freight',zh:'包装运输',definition:'每件产品的包装及运输费。'},
  'p08.launch':{en:'Launch cost',zh:'投产费用',definition:'生效期间发生的一次性投产费用。'},
  'p08.allocation':{en:'Division allocation',zh:'事业部分摊',definition:'全成本经营口径的分摊，独立于增量现金。'},
  cumulative_cash:{en:'Cumulative Cash Flow',zh:'累计现金流',definition:'截至该期末的现金流合计，包含第 0 期的现金流。'},
  present_value:{en:'Present Value',zh:'当期折现值',definition:'将当期现金流按该版本的折现率折回起算日。'},
  approved_budget:{en:'Approved Budget',zh:'批准预算',definition:'当前范围内纳入计算的获批预算事件金额合计。'},
  confirmed_actual:{en:'Confirmed Actuals',zh:'已确认实绩',definition:'财务口径已确认的发生事件合计。付款与回款独立记录。'},
  budget_balance:{en:'Budget Balance',zh:'预算余额',definition:'批准预算减去已确认实绩。'},
  draft_cost:{en:'Cost Drafts',zh:'成本草稿',definition:'等待独立确认的成本和调整。'},
  recorded_payments:{en:'Recorded Payments',zh:'已记录付款',definition:'按付款期独立登记的已确认成本结算。'},
  unpaid_confirmed:{en:'Confirmed Cost Less Payments',zh:'已确认成本减付款',definition:'已确认发生额减对应的已记录付款金额。'},
  etc_consumed:{en:'ETC Consumed',zh:'已冲减 ETC',definition:'在预测截止点之外纳入的同一预算范围的已确认成本净额。'},
  completion_variance:{en:'Variance at Completion',zh:'完工差异',definition:'批准预算减去预计完工成本。'},
  'cqa.operations.people':{en:'Operators',zh:'作业人数',definition:'该工序一个作业周期所需的操作人员数量。'},
  people:{en:'Operators',zh:'作业人数',definition:'该工序一个作业周期所需的操作人员数量。'},
  hourly_rate:{en:'Hourly Labor Rate',zh:'人工工时费率',definition:'用于计算人工成本的每小时费率。'},
  demand_takt:{en:'Demand Takt',zh:'需求节拍',definition:'该期间分配给本产品的净排产秒数除以良品需求量。各工位用重复次数和循环产出换算后的每件时长与其比较。'},
  line_balance:{en:'Line Balance',zh:'线体平衡率',definition:'各站每件时长之和除以工位数量与瓶颈工位每件时长的乘积。缺任一工位 CT 时无法确定。'},
  oee:{en:'Equipment OEE',zh:'设备综合效率',definition:'计划产能采用设备可用率、性能与良品率的乘积。实测运行 CT 已包含速度影响时，产能仅用独立的可用率和良品率。'},
  labor_efficiency:{en:'Labor Efficiency',zh:'人工效率',definition:'设计人时只修正与标准工时独立的人工损耗。批次实测以实际人时除以良品，直接采用已经发生的损耗。'},
  effective_capacity:{en:'Effective Capacity',zh:'有效产能',definition:'净排产时间乘共享分配和相应设备系数，再除以瓶颈工位每件时长，向下取整为期间良品件数。'},
  route_labor:{en:'Modeled Route Labor',zh:'路线人工',definition:'设计或实测的每件直接人时乘财务校准费率。'},
  unit_labor:{en:'Unit Labor',zh:'单件人工',definition:'在所选财务口径下，每件良品计入的直接人工成本。'},
  labor:{en:'Direct Labor',zh:'直接人工',definition:'各期的单件人工乘计入财务模型的产量。'},
  development_budget:{en:'Development Budget',zh:'开发预算',definition:'归属该产品或项目及期间的开发、样机与验证预算事件。'},
  development_gross:{en:'Gross Development Cost',zh:'开发费用总额',definition:'按发生期汇总的开发费用。试验包已覆盖的明细不重复计费。CQA 归档另列原始计划和追加费用。'},
  development_actual:{en:'Recorded Actual Cost',zh:'已回填发生额',definition:'已记录有发生凭据的开发费用。预算审批和确认流程独立管理。'},
  development_remaining:{en:'Development Budget Remaining',zh:'开发预算余量',definition:'开发预算减当期包含实际发生的费用预测。'},
  development_recovery:{en:'Customer Recovery Earned',zh:'已计入客户承担额',definition:'按约定计入当期的一次性承担额或单独列明的件价回收。'},
  net_engineering:{en:'Net Engineering Expense',zh:'净工程费用',definition:'开发发生额减按期间计入的客户承担额。'},
  development_cash:{en:'Development Cash Flow',zh:'开发现金流',definition:'开发相关客户回款减实际与预计付款，按各自期间计入。'},
  capital_gross:{en:'Gross investment',zh:'毛投资',definition:'资产的完整采购或参考金额。共用资产的项目明细合计一次。'},
  capital_allocated:{en:'Allocated asset capital',zh:'分摊资本',definition:'详细资产毛额乘项目各产品分配比例。包括已存在的共享资产。'},
  capital_new:{en:'Incremental acquisition',zh:'增量新购',definition:'本项目承担的新购资产资本。采购现金按付款节点列示。'},
  capital_payments:{en:'Capital payments',zh:'资本付款',definition:'该期间安排的资产采购付款金额。'},
  capital_receipts:{en:'One-time capital receipts',zh:'一次性投资回款',definition:'实际收款与预计余款按各自到账期计入。'},
  capital_agreed:{en:'Customer contract amount',zh:'客户补偿约定金额',definition:'按约定期记录的补偿合同金额。'},
  capital_net:{en:'Net capital outlay',zh:'净资本支出',definition:'资本付款减一次性资本回款。残值与件价回收单列。'},
  capital_salvage:{en:'Residual proceeds',zh:'残值回收',definition:'新增资产按项目比例在折旧期末计入的残值现金。'},
  capital_piece_cash:{en:'Piece-price receipts',zh:'件价回款',definition:'单独计价的件价补偿按实际或预计到账期计入。'},
  capital_piece_earned:{en:'Piece-price accrual',zh:'件价摊回',definition:'分期销量乘每件回收额，累计以约定上限封顶。'},
  capital_receivable:{en:'Customer compensation receivable',zh:'客户补偿应收',definition:'来自同一补偿协议的开票与应收记录。'},
  capital_actual_receipts:{en:'Actual compensation receipts',zh:'实际到账',definition:'按到账日期与依据记录的客户补偿金额。'},
  incremental_profit:{en:'Incremental pre-tax profit',zh:'增量税前利润',definition:'包含增量折旧和客户补偿收入的增量经营口径。'},
  depreciation:{en:'Full-cost depreciation',zh:'全成本折旧',definition:'计入全成本的年度资产折旧，包括分摊的共享旧资产。'},
  incremental_depreciation:{en:'Incremental depreciation',zh:'增量折旧',definition:'由新增投资产生的年度折旧。'},
  fx_to_base:{en:'Period exchange rate',zh:'分期汇率',definition:'一单位报价币种可换算的项目本币金额。'},
  discount_rate:{en:'Discount rate',zh:'折现率',definition:'将逐期现金折算至起点的年有效折现率。'},
  receivables:{en:'Trade receivables',zh:'经营应收',definition:'经营收入乘应收天数除以天数基准，另有收款排程的补偿单列。'},
  inventory:{en:'Inventory',zh:'存货',definition:'直接材料额乘库存天数除以天数基准。'},
  payables:{en:'Trade payables (signed)',zh:'经营应付（带符号）',definition:'直接材料额乘应付天数除以天数基准，并作为营运资金的抵减项。'},
  nwc:{en:'Closing working capital',zh:'期末营运资金',definition:'期末经营应收加存货减应付。可指定释放期间。'},
  nwc_change:{en:'Cash from working capital change',zh:'营运资金变动产生的现金',definition:'期初营运资金减期末营运资金。'},
  signed_tax:{en:'Cash tax (signed)',zh:'现金税（带符号）',definition:'按适用口径计算并作为现金流的税项。'}
};
const aliases:Record<string,string>={
  "cash": "cash_flow",
  "reported_revenue": "revenue",
  "cycle_time": "ct",
  "cqa.operations.cycle_time": "ct",
  "cqa.operations.hourly_rate": "hourly_rate",
  "cqa.cqa_full.unit_material": "unit_material",
  "factory_variable": "voh",
  "factory_fixed": "foh",
  "factory_scrap": "scrap",
  "factory_packaging": "p08.packaging",
  "factory_launch": "p08.launch",
  "factory_allocation": "p08.allocation",
  "factory_other": "other_costs",
  "archive_unit_foh": "foh",
  "unit_foh": "foh",
  "archive_unit_sales": "unit_sales",
  "unit_voh": "voh",
  "mpbitri": "cqa.mpbitri",
  "cbt": "cqa.cbt",
  "archive_engineering": "net_engineering",
  "piece_recovery": "capital_piece_earned",
  "salvage": "capital_salvage",
  "piece_receipts": "capital_piece_cash",
  "net_investment": "capital_net",
  "gross_investment": "capital_gross",
  "investment_recovery": "capital_receipts",
  "investment_cash": "capital_cash",
  "asset_allocated_amount": "capital_allocated",
  "asset_gross_amount": "capital_gross",
  "asset_depreciation": "capital_depreciation",
  "cash_flow_cny": "cash_flow",
  "cash_flow_usd": "cash_flow"
};
const families=[
  ['operation_','operation_labor'],['market_quote_','market_quote'],['inactive_market_quote_','market_quote'],
  ['market_volume_','market_volume'],['market_material_','market_material'],['part_delta_','part_delta'],
  ['landed:','landed_contribution']
];
export function definition(dictionary:Dictionary,key:string) {
  const resolved=Object.hasOwn(aliases,key)?aliases[key]:families.find(([prefix])=>key.startsWith(prefix))?.[1]??key;
  return (Object.hasOwn(dictionary.metrics,resolved)?dictionary.metrics[resolved]:undefined)??(Object.hasOwn(supplemental,resolved)?supplemental[resolved]:undefined);
}
export const nameOf=(dictionary:Dictionary,key:string)=>definition(dictionary,key)?.en??key.replaceAll('_',' ');
const statusText:Record<string,string>={missing_input:'Data missing',pending_finance:'Awaiting finance approval',
  zero_denominator:'Zero denominator',not_recovered:'Not recovered',no_irr:'No meaningful IRR',
  ambiguous_irr:'IRR is not unique',solver_failed:'IRR could not be resolved',recrossed:'Funding gap recurs',
  invalid_rate:'Invalid discount rate',incompatible_scope:'Incompatible scope',unavailable:'Unavailable'};
export function amountText(amount?:FinanceAmount|null,delta=false) {
  if(!amount?.displayValue)return '—';
  const [whole,fraction]=amount.displayValue.split('.');
  const number=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');
  const unit=amount.unit==='fraction'?'%':amount.unit==='percentage_point'?' pp':amount.unit==='year'?' yr':amount.unit?' '+amount.unit:'';
  if(delta&&!Number(amount.displayValue)&&Number(amount.value))return (Number(amount.value)>0?'+':'−')+'<0.'+'1'.padStart(fraction?.length??2,'0')+unit;
  return (delta&&Number(amount.value)>0?'+':'')+number+unit;
}
export function amountCell(amount?:FinanceAmount|null,delta=false,missing='Unavailable') {
  const status=amount&&statusText[amount.status];
  return '<span class="fin-value">'+escapeHtml(amountText(amount,delta))+'</span>'+
    (status||!amount?'<small class="fin-state">'+escapeHtml(status||missing)+'</small>':'');
}
export function varianceCell(amount:FinanceAmount|undefined,key:string,missing='No comparison') {
  const value=Number(amount?.value);
  if(!value||!Number.isFinite(value))return amountCell(amount,true,missing);
  const favorable=value>0!==['payback_period','peak_funding_requirement','eac','etc'].includes(key);
  return '<span class="'+(favorable?'fin-favorable':'fin-unfavorable')+'">'+escapeHtml(amountText(amount,true))+
    '<small class="fin-state">'+(favorable?'Favorable':'Unfavorable')+'</small></span>';
}
export const help=(dictionary:Dictionary,key:string)=>definition(dictionary,key)?
  '<button type="button" class="fin-help" data-definition="'+escapeHtml(key)+'" aria-label="About '+escapeHtml(nameOf(dictionary,key))+'" aria-expanded="false">?</button>':'<span hidden data-finance-metric="'+escapeHtml(key)+'"></span>';
export const metricLabel=(dictionary:Dictionary,key:string)=>'<span data-finance-metric="'+escapeHtml(key)+'">'+escapeHtml(nameOf(dictionary,key))+'</span> '+help(dictionary,key);
export function trace(output:CalculationOutput|undefined,side:'baseline'|'current') {
  return output?.upstreamInputs.length?'<button type="button" class="fin-link fin-trace" data-source="'+escapeHtml(output.id)+'" data-side="'+side+'">Sources</button>':'';
}
export function evidenceRows(inputs:InputEvidence[],periodLabel:(key:string)=>string) {
  return inputs.map(input=>'<li><strong>'+escapeHtml([input.sheet,input.cell].filter(Boolean).join('!')||input.sourceKey||input.id)+'</strong><span>'+
    escapeHtml(input.role)+' · '+escapeHtml(input.periods.map(periodLabel).join(', '))+
    (input.value===null?' · Data missing':' · '+escapeHtml(input.value.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''))+' '+escapeHtml(input.unit))+'</span></li>').join('');
}
export const financeUrl=(href:string,label:string,id='')=>'<a class="fin-link" data-finance-nav '+(id?'id="'+escapeHtml(id)+'" ':'')+'href="'+escapeHtml(href)+'">'+escapeHtml(label)+'</a>';
export const scopeFor=(report:FinanceReport|null,product:string)=>!report?null:product?Object.hasOwn(report.products,product)?report.products[product]:null:report;
export const rowFor=(data:FinanceReport|null,product:string,period:string)=>data?scopeFor(data,product)?.periodic[data.periods.findIndex(option=>option.key===period)]:undefined;

export function cashChart(container:HTMLElement,series:{name:string;values:(number|null)[]}[],labels:string[],currency:string) {
  const canvas=container.querySelector('canvas')!;
  const surface=canvas.getContext('2d');
  if(!surface)return ()=>{};
  function draw() {
    if(!surface)return;
    const width=canvas.clientWidth,height=canvas.clientHeight,dpr=devicePixelRatio||1;
    if(!width||!height)return;
    canvas.width=width*dpr;canvas.height=height*dpr;surface.scale(dpr,dpr);
    const style=getComputedStyle(container),colors=['--ds-secondary','--ds-accent'].map(key=>style.getPropertyValue(key).trim());
    const values=[0,...series.flatMap(item=>item.values.filter((value):value is number=>value!==null&&Number.isFinite(value)))];
    const max=Math.max(...values),min=Math.min(...values),range=max-min||1;
    const left=63,top=20,bottom=height-34,right=width-18;
    const x=(index:number)=>left+(right-left)*(labels.length===1?0.5:index/(labels.length-1));
    const y=(value:number)=>bottom-(value-min)/range*(bottom-top);
    const compact=new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1});
    surface.font='12px system-ui';surface.textAlign='right';surface.textBaseline='middle';
    for(const value of new Set([min,(min+max)/2,max,0])) {
      surface.strokeStyle=style.getPropertyValue(value===0?'--ds-muted':'--ds-divider').trim();
      surface.beginPath();surface.moveTo(left,y(value));surface.lineTo(right,y(value));surface.stroke();
      surface.fillStyle=colors[0];surface.fillText(compact.format(value),left-8,y(value));
    }
    surface.textAlign='center';
    const step=Math.ceil(labels.length/(width<500?4:8));
    labels.forEach((label,index)=>{if(index%step===0||(labels.length-1)%step>1&&index===labels.length-1)surface.fillText(label,x(index),height-14);});
    series.forEach(({values},j)=>{
      surface.strokeStyle=colors[j];surface.fillStyle=colors[j];surface.setLineDash(j?[ ]:[5,4]);surface.lineWidth=2;
      surface.beginPath();let started=false;
      values.forEach((value,i)=>{if(value===null||!Number.isFinite(value)){started=false;return;}
        if(started)surface.lineTo(x(i),y(value));else surface.moveTo(x(i),y(value));started=true;});
      surface.stroke();surface.setLineDash([]);
      values.forEach((value,i)=>{if(value===null||!Number.isFinite(value))return;surface.beginPath();surface.arc(x(i),y(value),3,0,Math.PI*2);surface.fill();});
    });
  }
  canvas.setAttribute('aria-label','Cumulative cash flow, '+currency+'. Exact values are in the Project Returns table.');
  const resize=new ResizeObserver(draw);resize.observe(canvas);draw();
  return ()=>resize.disconnect();
}
