# P08 商务、BOM 和工厂费用

2026-11-18 · 计算版本 P08.1 · 使用 P07 的 A 布局、来源定位和固定 Change Impact 面板。

本机审核入口为 [Project Station](http://127.0.0.1:18748/)。登录后，从项目的 **Revenue** 进入 Commercial & Volume，从 **Operating Profit / Margin** 卡下方进入 BOM Cost Inputs 或 Factory Cost Inputs。审核数据包含从 P05 备份恢复的 CQA 项目和一个合成草稿。本机账号文件路径见 `.deploy/finance-p08/latest-run.json` 的 `credentials` 字段。对 CQA 可选 **CQA Review Draft** 进行测算，审核库的当前预测指针沿用冻结基线的原状态。

| 模块 | 实现 |
|---|---|
| M01 · `/commercial` | 按产品、市场和年度记录车辆需求、配置率、单车用量、售价及年降。销量等于车辆需求 × 配置率 × 单车用量。按市场销量加权确定项目产品售价。直接售价从指定期间生效，年降递推使用上一期有效售价。 |
| M02 · `/bom` | 按产品、市场、料号、版本和期间显示零件用量、采购单价、报价币种、汇率来源、单件落地调整及产品落地贡献。可编辑或新增有出处的零件，价格录入保留原币。供应商模具记录具有稳定资产关联。 |
| M04 · `/factory-costs` | 区分变动制造、固定制造、废品、质保、包装运输、投产和事业部分摊。原生固定成本是期间金额。CQA 保留历史表的已分摊单位固定费率。废品与质保随销售价值联动，包装运输按产量，投产按期间金额。事业部分摊进入全成本经营利润并从增量现金中独立显示。 |

三页保留基线、版本、产品、期间、市场、来源和列表查询。年度生效范围可浏览并预览多期变更。新值、单位与期间影响、项目全期指标和计算路径在同一面板显示。**Save Draft** 按原修订与候选摘要保存。保存后可刷新或重开来源，也可返回原列表及筛选。冻结基线提供预览和按权限派生草稿。模块写权限在预览、正式保存与幂等重试时均由服务端复核。

## 原表映射与费用边界

- CQA 商务优先从 P05 已保留的 `Vol_SBS_Updated`、`Input` 与产品表市场列定位车辆需求、单车用量、报价和年降。超出需求表覆盖期时，以产品表的件数及等效每件用量标示归档输入。CQA 原表份额保持为归一化配置率。CQA 的事业部分摊、投产、质保等来源仍指向各自的历史控制格。标准经营口径继续显示待财务签认，MPBITRI 和增量 CBT 维持独立口径。
- BOM 计算为 **用量 ×（原币报价 × 有来源的 FX + 本币单件落地调整）**。CQA 的 AC 原表已经包含 M 列用量，因此以 AC 每产品贡献为起点，只把该零件的改动增量放入对应市场材料曲线，再应用历史材料因子与市场权重。原有隐含落地因素以调节项保留。历史行缺报价、有效原币、单位用量或汇率时显示为参考行。更换币种须能定位配置汇率。新增档案零件的 CQA 报价、用量和落地调整通过同一校验。
- 同一市场、料号、期间不得重复新增。供应商模具保留单一资产关联并显示给后续 M08。CQA 已包含在原投资分期的模具金额为参考记录，调价时保持原投资分期。新增模具金额作为独立候选资产记录，等待 M08 支付、投产及折旧管理。模具费在 P08 中不进入经常性单件材料与增量现金。
- 原生版本的详细工厂费用保留与原有“其他成本”输入的关系。原有其他成本代表独立的未分项金额。CQA 则替换对应历史分项，避免在归档总额之上重复累加。同一 CQA 产品和期间的旧聚合材料覆盖与详细 BOM 覆盖互斥。
- 使用 P01 定点数及未显示舍入值。报价和比率按配置的精度存储；期间资金金额按币种精度。量的计算先在市场内用精确比例相乘并加权，产品总量按整件四舍五入。已存在且结果有效的输出若因候选变为缺数，面板显示解释并阻止保存。多期年降效果可持续到后续年度。

## 验证与可重跑命令

| 合成算例 | 输入变更 | 单件 / 期间 / 项目 |
|---|---|---|
| T3 · `T3-CLIP` · `Supplier quote Q-01` | 第 1 期，每件产品使用 2 个零件，报价 4 → 5 CNY，产销 1,000 件 | 单件材料 +2；年度材料 +2,000；经营利润与现金流各 −2,000；NPV −1,818.18 |
| 商务 | 第 1 期售价 20 → 22 CNY，产销 1,000 件 | 收入与经营利润各 +2,000；NPV +1,818.18 |
| 制造 | 第 1 期变动制造费用 1 → 1.25 CNY/件，产销 1,000 件 | 年度费用 +250；经营利润与现金流各 −250；NPV −227.27 |

T3、售价及制造费用对每次预览、保存、重读和恢复原输入分别断言。源行来源、币种、权限、数量、多个市场加权、本币换算、跨年递推、模具去重及新增行均有回归。真实 CQA 的 6 项试算来自 P05 冻结来源，其中有独立的原表材料差额核对。真实值截图留在审核副本目录的 `browser/`。

```powershell
node --experimental-strip-types scripts/finance-workspace-preview.ts --p08
# 在第二个终端执行
node scripts/verify-finance-p08-browser.mjs
node --experimental-strip-types scripts/verify-finance-p08-archive.ts --record
node --experimental-strip-types --test tests/finance-p08.test.ts
node --experimental-strip-types scripts/check.ts
```

[真实来源脱敏对照](archive-checks.json) · [浏览器操作证据](browser-checks.json) · [完整检查](check-summary.json)

| 截图 | 桌面 | 窄屏 |
|---|---|---|
| 商务 | [Commercial & Volume](desktop-commercial.png) | [Commercial & Volume](mobile-commercial.png) |
| BOM | [BOM & Purchasing](desktop-bom.png) | [BOM & Purchasing](mobile-bom.png) |
| 工厂费用 | [Factory Costs & Launch](desktop-factory-costs.png) | [Factory Costs & Launch](mobile-factory-costs.png) |
| T3 | [共用影响面板](desktop-t3-impact.png) | [共用影响面板](mobile-t3-impact.png) |

后续 M08 以 `assetKey` 取供应商模具关联，接入投资前需核对既有资本分期与新增资产是否为同一笔。M03 的工时实测、M08 的资本化、M10 的预算确认、P13 的归因桥按各自阶段接续。
