# P14 · M01–M10 验收矩阵

审核从主站首页已有项目卡进入 **Project Finance**。同一审核数据库包含 P05 授权 CQA 冻结档案和有标识的合成项目。下表的金额为合成技术验算，原表列仅提供来源定位。逐项使用当前运行代码在 Chrome 打开业务页面和原始行，验证刷新增量及返回。相关角色、预览、保存及数值断言见 [本轮浏览器证据](browser-checks.json)。

| 模块 | 入口 | 可改输入 | 影响结果 | 原始依据 | 本轮证据 |
|---|---|---|---|---|---|
| M01 商务与销量 | **Revenue** 或 **Commercial & Volume** · `/commercial` | 车型/市场需求、配置率、单车用量、报价、年降与币种 | 销量与加权价进入收入、利润、现金和回报。业务录入账号将 20 改为 21 CNY，利润 +1,000、NPV +909.09 CNY | CQA `Vol_SBS_Updated`、`Input` 与各产品市场价量列。合成 `Sales quote EU-1` | P08 商务源行往返；P14 业务角色真实保存、原会话撤权；定义键覆盖 |
| M02 BOM 与采购 | **BOM & Purchasing** · `/bom` | 用量、原币报价、落地调整与模具资产关联 | T3 用量 2，报价 4 → 5 CNY，年度直接材料 +2,000、NPV −1,818.18 CNY | CQA BOM 的用量、报价、落地费与报价币种。合成 `T3-CLIP / Supplier quote Q-01` | P08 T3 保存、反向恢复、来源和币种；P14 窄屏原行刷新和只读 |
| M03 制造工艺与人工 | **Operating Profit / Margin** 或 **Manufacturing & Labor** · `/operations` | 工位 CT、定员、循环产出、人工效率、费率、净排班与实测批次。批准后选用实测 | 30 秒、2 人的设计人工 1.00 → 1.20 CNY/件。10,000 件现金减少 2,000，NPV −1,818.18；实测瓶颈与缺测状态独立验证 | CQA AME 第 35/36 行、产品 Financials 102、D590 和 C594:D600。合成工位测时、良品和校准费率 | P09 两次采纳与实测回显；[ME 影响截图](desktop-me-impact.png) |
| M04 工厂费用与投产 | **Factory Costs & Launch** · `/factory-costs` | 变动和固定制造费、废品、质保、包装运输、投产与分摊 | 合成单位变动制造费 1 → 1.25 CNY，利润 −250、NPV −227.27 CNY。内部费用分摊按全成本口径处理 | CQA Financials 107/108、197–201、209 与历史分摊依据。合成 `Plant plan F-01` | P08 工厂费用预览、保存和重开；P14 入口、期和产品往返 |
| M05 开发与 PM 工时 | **Engineering & PM Hours** · `/engineering` | 工时、费率、差旅、发生/付款期和各产品分配 | 原 5 小时 × 100 加 25 CNY 差旅。新增 2 小时 × 100 增加 200 CNY 开发费用 | CQA PM G/I/J/K 和 Financials 426/427。合成 `PM Planning Hours`、设计评审工时单 | P10 源行与新增工时保存；P14 工程页深链和词条 |
| M06 样机与试制 | **Prototypes & Builds** · `/prototypes` | 批次数量、材料、加工、人工、运输与试验包覆盖 | 4 → 10 件，原包覆盖 4 件，新增 6 × 300 = 1,800 CNY。与复测合计 +3,800，NPV −3,454.55 | CQA DV/PV 样件关联列。合成 `T4 Sample Batch`、`DV Package` | P10 增样单改、包反向链接与组合保存；[组合截图](desktop-development-impact.png) |
| M07 试验验证与认证 | **Validation & Certification** · `/validation` | DV／PV／认证包、复测轮次、实际发生与付款日 | 一轮复测新增 2,000 CNY。质量账号回填发生与次年付款，单年现金 +2,000/−2,000，工程费用与原发生期一致 | CQA DV X/AE、PV Y；PV V:X 由 DV 覆盖。合成质量验收 Q-17 和付款 P-17 | P10 质量角色写入、移动付款和非职责限制；P14 深链刷新 |
| M08 设备模具与投资 | **Equipment & Investment** · `/investment` | 资产金额、采购支付期、产线关联、分摊、启用、折旧和客户补偿到账期 | 10,000 CNY 预计回款从第 1 年延至第 2 年，年度现金 −10,000/+10,000，回收期延后，NPV −826.45。全期回款、利润和资金峰值保持原额 | CQA Financials 294–300 与 430。合成 `PO-T5-DEPOSIT`、补偿合同及应收凭据 | P11 完成延期保存和刷新。P13/P14 核对来源；[延期截图](desktop-delayed-recovery.png) |
| M09 营运资金与回报 | **Project Returns** · `/returns`，也可从 NPV、IRR、回收和资金卡进入 | 应收、应付、库存天数、税率、折现率与释放期 | 36/36/18 天与 20% 税率得到 16,000 CNY 营运资金及 22,000 CNY 现金税。回报由合并逐期现金重算 | CQA Financials 329、330、446–448、Exec Sum 折现率和入账期间。合成 T5 现金及付款安排 | P11 营运资金与资金低点往返；P14 六组指标、全成本/增量、恢复后 NPV 复核 |
| M10 预算执行与版本 | **Budget Execution** · `/budget` 和 **Version Comparison** · `/compare` | 成本范围、批准预算、发生、付款、调整、ETC 及比较的两版和截止期 | T6 独立确认后 ETC 匹配消耗。最终调整后确认成本 430、付款 125、ETC 700、EAC 1,130、完工差额 −130 CNY。金额桥逐产品、期间对回版本总差 | 合成 T6 服务验收、独立审批凭据和更正。CQA 模拟阶段账以 AME!F35 单一变更为依据，原版冻结 | P12 独立审批、同会话撤权、修订冲突。P13 比较、撤销、来源深链；[金额桥截图](desktop-comparison.png) |

中文释义、键覆盖和三种操作入口集中记录在 [释义核验](glossary-checks.json)。实际数据状态及需签认的口径见 [P14 交接](README.md)。
