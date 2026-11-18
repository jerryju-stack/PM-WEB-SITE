# P06 共用分期计算与修订绑定预览

2026-11-18 · 计算版本 `P06.1` · 指标/精度契约 `P01.1` · 承接 P05.1 冻结来源与 schema 11。

本步完成共用计算服务、服务端预览/保存/比较契约和供 P07 接入的异步结果控制器。仅在本机独立 DATA_DIR 验证。页面接入、业务模块录入界面、实绩确认流程与生产发布分别继续由 P07–P15 执行。

## 交付与证据

| 内容 | 位置 |
|---|---|
| 共用计算入口与版本比较 | `lib/finance-calculation.ts` |
| 精确分数运算、状态及输出契约 | `lib/finance-decimal.ts`、`lib/finance-calculation-types.ts` |
| CQA 分期计算与项目回报 | `lib/finance-cqa-calculation.ts`、`lib/finance-returns.ts` |
| 生效期间、字段变更及依赖路径 | `lib/finance-preview.ts` |
| 项目权限、修订、原子保存、幂等、读取接口 | `lib/finance.ts`、`server.ts` |
| 异步旧成功/旧失败丢弃及取消 | `src/finance-preview-state.ts` |
| T1/T2 实际结果 | [examples.json](examples.json) |
| 独立 Decimal/闭式参考计算 | [independent-examples.json](independent-examples.json) |
| 四产品逐期、全期、合并现金及回报对表 | [reconciliation.json](reconciliation.json) |
| 类型、全部回归及 Git 差异检查 | [check-summary.json](check-summary.json) |

`reconciliation.json` 只保存源指纹、源格位置、通过状态、容差、计数与历史异常。真实金额、完整计算图和预览明细留在被 Git 忽略的 `.deploy/finance-p06/run-*/`。`.deploy/finance-p06/latest-run.json` 索引最近运行；`run.json` 给出独立 DATA_DIR、项目、冻结基线、新草稿及计算摘要。运行不会改写 P05 的原库、冻结基线、工作簿或外链。

## 一份计算用于五种调用

`calculateFinance(snapshot)` 是没有数据库写入的纯函数。基线、当前预测、单次预览、预算与版本比较都调用它。项目和版本身份、修订及快照摘要由授权服务包装返回。

1. 校验年度期间从 ordinal 0 连续排列，保留全部零现金流年份，保留原始 Year 0 标签。
2. 按启用产品、同期间和同报告币种生成现金流。P05 已分配的共享成本只随各产品计算一次；不再把 DV/PV 明细、PM 合计、支付事件重复相加。
3. 合并实际纳入项目的产品现金流后计算项目回报。项目 IRR、回收期及峰值不从产品结果相加或平均。利润率由利润合计除以收入合计。
4. 用同一引擎分别计算前后版本，再以未显示舍入的结果求差。币种、期间、启用产品集合、财务口径、字典及计算版本不一致时，差额为 null / `incompatible_scope`。

每个数值输出都含 `metricKey`、`basis`、`unit`、`currency`、`periods`、`productScope`、`asOf`、`dictionaryVersion`、`calculationVersion`、`formula`、`dependencies`、`upstreamInputs`、`status`、`value`、`displayValue`、`displayDecimals` 与精确 `exact` 分子/分母。`inputs` 索引将上游标识追到输入键、来源键、工作表/单元格、来源角色、单位和期间。原导入记录的 `not_implemented` 标记保留来源历史；运行结果明确标注实际算法 `P06.1`，紧凑保存后的版本也记录 `P06.1`。不识别的已存计算版本返回 409，不能悄悄套用当前算法。

## CQA 计算边界

P06 重算逐期销量换算、收入、材料、人工、厂费、全成本 MPBITRI、增量 CBT、税、营运资金、净投资、两币种现金流、累计现金流及回报。金额从 P05 保留的源精度读取；不把逐行已经按货币两位舍入的控制值用作计算输入。收入、人工总额、MPBITRI、CBT、现金流和累计现金的终端缓存不参与计算，验证程序故意污染这些缓存后，计算报告仍完全一致。

本步的上游边界是 P05 冻结的业务假设和分期计划。年度价格、材料单价、制造费率、折旧、其他厂费、分摊、开发分期和投资分期有明确来源；其中由 Excel 得出的上游假设仍标为冻结计划，不宣称已重建整本工作簿。原料报价到落地成本、完整开发包覆盖和资产生命周期的编辑模型继续留给 P08–P11。

制造人工从 AME 人数、CT、Financials 的人工效率/宽放、小时费率和每件工序次数重算 SOP 单件人工；再乘原件保留的年度费率/效率计划系数。设备 OEE 不再乘作人工效率。双锁扣每件次数为 2，单锁扣为 1。年度系数的分母缺失或为零且不能确定新人工时返回可解释状态，不伪造系数。

当前 CQA 紧凑变更支持 `cqa.operations.cycle_time`、`cqa.operations.people`、`cqa.operations.hourly_rate` 和 `cqa.cqa_full.unit_material`。共用 AME 输入可影响多个产品；每个受影响产品仍返回自己的计算路径。原始值保持不变，按期间持久化在输入的 `conversion.p06Overrides` 中。其他 CQA 字段返回明确的 `Unsupported calculation driver`，待所属业务模型接通后扩展，不能把未实现影响返回零。

网站原生算例支持两种明确模型：`cash_series` 使用每产品每期完整现金流；`manufacturing` 使用销量、售价、材料单价、工序参数、其他成本与显式现金调整。现金调整代表同范围税、非现金项、投资和营运资金对现金的净调整，T2 明确设为零。缺少工序、费率、效率、完整现金期或正确单位时，相关结果保持缺数。网站经营口径只有 `operatingMapping=approved` 时输出标准经营利润；真实 CQA 的标准经营利润和利润率继续为 `pending_finance`，其 MPBITRI 独立显示。

## 预览、保存与比较契约

项目由 URL 绑定，所有操作复核当前身份、项目访问与职责。紧凑预览请求如下，生效期为完整年度期间键，当前不做年内比例分摊：

```json
{
  "requestKey": "edit-ct-1",
  "reason": "T2 cycle time adjustment",
  "revision": 0,
  "clientSequence": 1,
  "effectivePeriod": {"from": "year-1", "to": "year-1"},
  "changeSet": [
    {"collection": "inputs", "key": "cycle_time", "value": {"coefficient": "36", "scale": 0}}
  ]
}
```

响应给出项目、版本、原修订、请求序号、`candidateSha256`、`calculationSha256`、字段旧/新值和来源、前后完整计算报告、各项目/产品/逐期/预算指标旧新差额、`affectedProducts`、`affectedPeriods`、带原标签/序号/已知日历年的 `affectedYears`、依赖图 `paths` 和带阶段的解释错误 `errors`。受影响期间包含累计现金流受到影响的后续年度；字段本身的生效期间单独返回。预算变更单独保留其产品和期间范围，不以经营现金没有变化判为无影响。金额差保留币种，比率差为百分点，回收期差为年。无有效前值或后值时差额为 null，前后状态均可查看。

预览不插入来源、输入、变更集、审计或回执，不改变修订或项目指针。保存时把同一 `revision`、`changeSet`、`effectivePeriod` 与预览返回的 `candidateSha256`、`previewCalculationVersion` 一起送入 PUT，另给保存的 `requestKey` 和 `reason`。服务重新计算候选摘要；摘要或算法不符返回 409。成功保存返回的 `calculationSha256` 与预览一致，重读和重开数据库后仍一致。失败整笔回滚；相同请求重试返回原回执并重新检查权限。冻结版本可预览，保存须先派生新草稿。

| API | 用途 |
|---|---|
| `GET /api/projects/:p/finance/calculations` | 原子读取批准基线和当前预测的计算，缺指针返回 null |
| `GET /api/projects/:p/finance/versions/:v/calculation` | 指定版本计算，含预算与全部来源依赖 |
| `POST /api/projects/:p/finance/versions/:v/preview` | 预览上述紧凑变更；保留 P04 小快照预览兼容性 |
| `PUT /api/projects/:p/finance/versions/:v` | 按原修订及候选摘要原子保存紧凑变更 |
| `POST /api/projects/:p/finance/versions` | 传 `parentId`、`parentRevision`、`name` 派生服务器内已存大版本，客户端不传完整 P05 来源 |
| `POST /api/projects/:p/finance/versions/:v/compare` | URL 版本为 Before；正文含 `revision`、`otherVersionId`、`otherRevision`、`requestKey`、`reason` |

P04 原有完整快照 HTTP 行数和请求体限制保留。紧凑变更上限 200 个字段，只能改既有输入值或预算事件金额，不能替换来源、项目/产品身份、公式或币种。重复字段、倒置/外部期间、错误货币精度、不支持的驱动均拒绝。

异步控制器每次请求产生递增序号，匹配项目、版本、修订、请求键和序号后才接受响应。旧成功、旧失败、上下文不符及取消后的结果都丢弃。服务端同时以数据库修订防止旧版本预览和写入。该控制器已有延迟乱序测试，实际页面绑定属于 P07。

## 异常与精度

金额、单价、比例、汇率、合计、折现、插值和差额使用 BigInt 分数，最后按十进制中点远离零显示。IRR 使用一次变号的唯一根判定、对数利率二分与独立精确 NPV 残差校验。缺数、错误缓存不当作零；只有 P01 明确的空白计划格按无业务贡献处理。

| 情况 | 返回 |
|---|---|
| 缺任一必要现金期 | 全生命周期回报为 null / `missing_input` |
| 缺折现率或折现率 ≤ −100% | NPV 为 `missing_input` 或 `invalid_rate`；未折现指标及可解释 IRR 可继续计算 |
| 收入、人工效率或单循环良品数分母为零 | null / `zero_denominator` |
| 全零或同号现金流 | IRR null / `no_irr` |
| 多次变号且未证明唯一性 | IRR null / `ambiguous_irr` |
| 数值范围、收敛或绝对残差未满足 P01 | IRR null / `solver_failed` |
| 从未出现资金缺口 | 回收期和峰值为 0 / `no_funding_required`，峰值期间为 null |
| 有缺口且全期未首次回收 | 回收期 null / `not_recovered` |
| 首次回收后再次转负 | 保留首次线性回收值并标 `recrossed` |
| 多个同样最低点 | 峰值返回首次原期间 |

独立对表用 P01 绝对容差：主币金额 0.01、单价 0.000001、比例小数 0.00000001、年数 0.000001。件数、原期间、产品集合、状态和首次峰值期精确核对。差异不以显示值重算，也不放宽容差。当前对表无新增超差项。P05 的 11 个历史异常按原位置保留，未改成零或宣称已解决。

预算按独立事件集求预算、实绩、ETC、EAC、预算余额及预计完工差额，支付/回款不重复作为成本。无完整事件集为缺数；只有明确 `budgetComplete=true` 才允许空集合为已核实的零。发生事件仅在已建档的 `budgetIncurredBasis=confirmed` 下纳入已确认实绩。P06 不新增审批流程；真实 P05 没有实绩事件，所以已确认实绩仍为 null。

## 可重跑命令

在仓库根目录运行，沿用 Node.js 24+。Python 优先 `CQA_PYTHON`，否则使用现有 Codex bundled Python；均只用标准库。实际样本优先 `CQA_SAMPLE_XLSX`，否则在获准 F 盘目录按 P01 完整指纹定位。

```text
node --experimental-strip-types scripts/verify-finance-p06.ts --public-only
node --experimental-strip-types scripts/verify-finance-p06.ts --record
node --experimental-strip-types --test tests/finance-calculation.test.ts tests/finance-calculation-service.test.ts tests/finance-calculation-http.test.ts
npm run check
```

本机运行环境没有提供 `npm` 可执行文件，因此完整检查实际执行 `node --experimental-strip-types scripts/check.ts`，它就是 `package.json` 中 `npm run check` 的脚本内容；没有安装或升级包管理器。

第一条不需要真实样本。第二条需要 P05 的 `.deploy/finance-p05/latest-run.json` 和完整备份，在新 DATA_DIR 中恢复验证后进行重算、预览、派生/保存和重开，不对 P05 原库写入。独立 Python 程序直接从只读 OOXML 取控制值；T1 用二次方程闭式 IRR，T2 用人时公式，没有导入应用计算代码。需要单独检查公开证据时：

```text
<CQA_PYTHON> -X utf8 scripts/verify-finance-p06-examples.py
<CQA_PYTHON> -X utf8 scripts/verify-finance-p06-examples.py --results docs/validation/project-finance/P06/examples.json
```

本机 HTTP 回归第一次在沙箱中遇到 `connect EACCES 127.0.0.1`，已在允许本机回环连接的执行环境通过；测试始终使用独立临时 DATA_DIR 和虚构数据。真实基线验证不建立公开服务。

下一步 P07 可调用上述读取和预览契约，接到已选 A 布局的英文页面。网站标准经营口径财务签认、工位实测、样机/试验批次及已确认支出继续保留 P01/P05 的待办状态。
