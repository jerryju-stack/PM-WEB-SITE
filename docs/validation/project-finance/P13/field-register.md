# P13 · 可编辑字段、影响路径和验证登记

字段名采用写入契约，点号表示对象成员，`[]` 表示每行。每行将同一依赖路径的输入列全。**零**指该字段单独改变时项目经营和现金金额的变化为 0。对账和追溯字段给出其业务输出。允许录入的备用报价、未采纳路线和已停用口径按对应状态显示。示例依据 P08–P12 已登记回归及 [P13 定向测试](../../../../tests/finance-p13.test.ts)。

| 模块或保存路径 | 可改字段 | 影响路径与输出 | 验证例 |
|---|---|---|---|
| M01 商务 | `vehicles, configuration, units_per_vehicle` | 市场需求 → 整件销量与组合 → 收入、单位成本加权、件价回收、现金和 NPV | P08 多市场；P13 1,000 → 1,100 后与价格变化同时对回。 |
| M01 商务 | `sales_price, annual_reduction, currency` | 原币报价或前期报价 × 年降因子 → 加权售价 → 收入、按售价计提厂费、利润和现金 | P08 前置报价与跨两期年降、USD 折算；P13 售价单改。 |
| M02 BOM | `part_quantity, part_price, landed_adjustment, currency` | 用量 × (换算报价 + 落地调整) → 单件材料、逐期材料、利润、营运资金和现金 | T3 2 × (4 → 5) 验算；P08 新增来源及 USD。 |
| M02 BOM | `tooling, assetKey` | 模具报价 → 同资产 ID 的报价取价 → 分摊资本、采购付款和折旧。未设资本化安排的报价保留，当前现金为零。已包含在 CQA 的档案资本沿原分期 | P08 模具防重；P11 以采购报价为资产金额时改报价联动。 |
| M01／M02／M04 新记录 | `recordType, productKey, marketKey, partNumber, reference, effectivePeriod.from, effectivePeriod.to` | 产品、市场和期限定到入账曲线。记录类型决定公式。稳定料号防重；只变依据或料号标签时金额为零 | P08 同市场料号拒重、选两期应用年降、归档来源。 |
| M03 设计路线 | `productKey, effectivePeriod, stations[].ct, stations[].people, stations[].output, stations[].repeats, stations[].efficiency` | 已采纳设计 → 人时、单位人工、成本；CT／循环产出／重复次数同时进入工位负荷及产能 | T2 30 → 36 秒、P09 瓶颈转移、P13 CT 与费率组合；实际批次采纳时金额从实测人时进入。 |
| M03 设计产能 | `lines[].line, shifts, hours, days, allocation, oee, stations[].line, stations[].station`（各子项） | 线与工位的稳定关联 → 负荷、共享线校验、节拍／平衡率、有效产能。有效记录的净排产时数、线体份额、设备 OEE 单改时财务为零 | P09 共线份额与独立 OEE；独立人工效率才进入设计人时。 |
| M03 实测 | `designKey, personHours, goodPieces, times[station], capacityFactors[line]` | 关联设计并核对完整批次。采纳后总人时 ÷ 良品 → 单位人工。逐站 CT 和可用率 × 良率定位瓶颈及有效产能；有效批次上只改实测 CT 或产能系数时财务为零 | P09 2 人时 ÷ 100 件，试产与量产、缺测阻止采纳。 |
| M03 正式人工与基础选择 | `rate, mode, sourceKey` | 校准费率 × 选用人时，设计／实测／原表三种口径进入逐期人工；原表共用工序同步影响相关产品 | P09 设计与实测互切；P13 AME!F35 单点、两产品、项目及 CNY/USD。 |
| M03 记录识别 | `revision, stations[].operation, batch, date, stage, reviewer, reference` | 标识设计修订或实测批、审核人及凭据；同一被选用的人时量和期间下金额为零 | P09 量产与试产回查、缺测批次和来源重开。 |
| M04 工厂费 | `variable, fixed, scrap, warranty, packaging, launch, allocation` | 单件变动／包装 × 量；固定、投产与分摊按期；废品、质保按销售额。事业部分摊进入全成本利润。CQA 保留已分摊单位固定成本 | P08 变动制造 1 → 1.25、分摊零现金、CQA 六项试算。 |
| M05 工程与项目管理 | `quantity, components.rate, components.travel` | 工时 × 费率 + 差旅 → 发生、付款、预算余量、现金和利润 | P13 5×100 → 6×120，分开工时、费率、共同项；差旅随单据单列。 |
| M06 样机 | `quantity, components.material, components.processing, components.labor, components.expedite, components.freight` | 未被包覆盖的件数 × 单件五项成本 → 发生、付款、余量和 NPV | T4 原包 4 件，新增 6 件 × 300。 |
| M07 验证 | `quantity, components.rate, coverage[].provider, coverage[].quantity` | 试验量／工时 × 费率，DV 包覆盖量扣减，包价记一次 → 净开发费用、余量和付款 | T4 已覆盖的 PV、试验包和 CNY 2,000 复测。 |
| M05–M07 分期和分摊 | `period, paymentPeriod, allocations[].productKey, allocations[].share` | 发生、付款由各自期间决定，分摊到产品再合计 | P10 客户分摊及实际延付，P13 保持生命周期利润并重新折现。 |
| M05–M07 收回计划 | `recovery.method, amount, productKey, earnedPeriod, receiptPeriod`（各子项） | 一次性承担或销量 × 明示件价 → 按期确认和回款 → 净工程利润和现金桥 | P10 试验和包覆盖核对；P13 到账时点政策。 |
| M05–M07 实际 | `incurred, payment, receipt` 下的 `amount, period, date, reference` | 发生额替换预测，并分别抵扣已付款、已收回的余额。日期校验期间；同会计期的日期证据／备注单改金额为零 | P10 实际发生与跨期付款，P13 同额实际从 Year 0 移到 Year 2。 |
| M05–M07 标签 | `module, costRef, title, group, category, role, stage, reference, allocationBasis` | 模块、有效成本身份、类别和验证阶段控制模板、单位及可用覆盖。文本标识、角色和依据核对，无分类规则变化时金额为零 | P10 独立复测源行、不可重复费用号、DV/PV 校验。 |
| M08 资产与发运 | `assetId, category, mode, gross, allocations[].productKey, allocations[].share, orderPeriod, servicePeriod, life, residual, payments[].id, payments[].period, payments[].share` | 识别关联采购；决定资本毛额、全成本折旧、增量采购付款、残值及分期影响 | T5 毛额 +2,000、共享旧资产 25% 分摊和新增现金为零。P11 同一工具去重。 |
| M08 资产证据 | `title, purchaseReference, meReference, lineId, basis, payments[].reference` | ME、工艺线、采购和付款证据追溯；只改这些记录字段时金额为零 | P11 资金低点 → ME、PO、付款凭据。 |
| M08 客户补偿 | `agreementId, assetKey, agreementPeriod, amount, receivable.period, receivable.amount, receiptPeriod, receipts[].id, receipts[].period, receipts[].amount, piece.productKey, piece.rate, piece.first, piece.last, piece.included` | 连接资产和产品、协议／应收、确认、实收及预计收款；独立件价销量封顶，已含件价走商务口径；应收登记期进入应收账，单改时累计到账为零变化 | T5 同额延付 NPV −826.45；P11 实收占预计余额及件价封顶。 |
| M08 补偿依据 | `title, reference, receivable.reference, receipts[].date, receipts[].reference` | 会计期、对账来源与回款凭据；同期间的合法日期及文字单改金额为零 | P11 合同与应收来源往返。 |
| M09 营运资金与税 | `productKey, period, receivableDays, payableDays, inventoryDays, days, tax, release` | 应收、存货、应付与期末释放 → 营运资金变动；税率 → 现金税 → NPV | P11 36/36/18 天和税率 20%；释放列入单期现金。 |
| M09 估值／FX | `discount, fx_to_base.value` | 年度折现 → NPV；批准的分期 FX → 商务、材料和模具的本币金额。IRR 始终由现金序列求解 | P13 10% → 25% 与单独折现桥；USD/CNY 3 → 4 成本差 −4,000。 |
| M09 证据 | `reference`、估值来源、FX 来源说明 | 估值及分期汇率的依据，文字单改金额为零 | P13 证据说明变化与零桥。 |
| M10 执行口径 | `currency, taxBasis, recognition, reference` | 项目币种和精度、含税与确认口径 → 预算有效记账。口径依据或声明本身没有项目经营金额影响 | P12 JPY 零位、独立审批和拒绝更改有凭据的口径。 |
| M10 成本范围 | `scopeId, title, productKey, reference` | 分组及归属，匹配一笔执行记录与该范围预测；标题和依据单改金额为零 | T6 两个范围独立消耗 ETC。 |
| M10 预算及实际 | `scope, period, amount, documentId, date, relatedKey, title, reference`，确认／撤回及决定 `reference` | 独立批准预算；确认发生／调整影响余额与适用 ETC；支付进入结算账。依据字段金额为零；按凭据改期、金额、关联收据影响所在执行范围 | T6 确认 +50、跨期更正 −20、付款 125、撤回和重放。 |
| M10 ETC | `scope, period, amount, reference` | 记录范围及截止期的剩余预测，扣除匹配已确认成本 → ETC、EAC、完工差额 | T6 后续确认、原成本更正及 ETC 700 超支。 |
| 通用 P04/P06 兼容可改输入 | `cash_flow, volume, unit_sales, unit_material, cycle_time, people, hourly_rate, labor_efficiency, units_per_cycle, cycles_per_unit, other_cost, cash_adjustment`、CQA 存量人工和材料覆盖、历史 `budget/incurred/etc` | 原生经营或纯现金模型的驱动；归档源行倍率和期间落入原 CQA；历史预算输入使用当期认可的账表。已由详细模型接管的聚合、已采纳路线的旧人工和已被 P12 接管的旧账阻止再次写入 | P06 T1/T2、P08 分项覆盖互斥、P13 跨产品与旧聚合保护。 |
| 整版保存／批量导入 | `name, asOf, currency, currencyScale, basis, policy.rules`、维度周期／有效产品、输入和事件来源及生效字段、版本原因 | 名称和原因金额为零。As of 标记版本数据截止，比较另选择估值截止期。币种、计量精度、周期、有效范围和计算口径决定能否比较；已配置输入及事件由对应模块计算 | P13 批量三项、证据仅改、期间对齐、产品新增与不同币种。 |

P13 字段检查发现原生 `fx_to_base` 的计算已读取批准来源，但紧凑编辑此前未接通。本步开通现有汇率源且校验正值。另在紧凑编辑入口阻止已被详细商务、BOM 或 P12 执行账取代的旧值修改。档案中已资本化的模具、未选作财务依据的实测和 CQA 的标准经营利润待签认分别采用现有记录状态。
