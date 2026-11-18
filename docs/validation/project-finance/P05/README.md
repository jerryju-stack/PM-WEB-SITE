# P05 CQA 基线导入与来源交接

2026-11-17 · 映射 P05.1 · 承接 [P01 来源矩阵](../P01/source-matrix.json)、[P01 指标字典](../P01/metric-dictionary.json)及 [P04 契约](../P04/README.md)。仅执行本机导入；正常网页接入和网站财务计算分别留给 P07、P06。

本步完成只读原件的“预览 → 独立校验 → 确认导入”。原件指纹与 P01 一致。实际导入使用独立、被 Git 忽略的本地验证 DATA_DIR，复用该库的现有项目 ID 与永久管理员身份。确认将一个明确选择的空草稿一次性写成冻结的历史 CQA 基线，并更新批准基线指针；不自动选择当前预测。该冻结记录表示原件来源和技术对表已锁定，不替代 P01 中仍待财务签认的经营口径，也不把预算变成已确认支出。

## 本次交付

| 内容 | 证据 / 位置 |
|---|---|
| 四产品、11 期、输入及原件核验结果 | [import-report.json](import-report.json) |
| 脱敏来源、稳定键、范围与覆盖关系 | [source-map.json](source-map.json) |
| 差异及历史未解释项 | [differences.json](differences.json) |
| 完整类型检查、回归和差异检查 | [check-summary.json](check-summary.json) |
| 可重跑本机流程 | scripts/verify-finance-p05.ts |
| 离线导入命令 | scripts/import-finance-cqa.ts |
| 只读提取及共享公式还原 | lib/finance-cqa.ts |
| 独立 Decimal / P01 检查 | scripts/validate-finance-cqa.py |
| 原子确认、权限和幂等交接 | lib/finance-cqa-import.ts、lib/finance.ts |

真实金额、公式全文、外部路径、完整来源快照、独立对照值及数据库均保存在本机 .deploy/finance-p05 下。最新一次运行的具体位置索引为 .deploy/finance-p05/latest-run.json，包含 data、projectId、versionId、previewId、privateOutput、backup 和 restored。仓库证据仅含结构、计数、指纹、单元格位置和状态。

每个 privateOutput 目录包含：

- preview.json：项目、目标版本、原修订、项目指针修订、操作者、源指纹、快照摘要及明确动作 freeze_cqa_baseline。
- candidate.json：完整规范化快照、原始/缓存/网站值区分、公式、来源、依赖和私有报告。
- annual-inputs.json 及 annual-outboard.csv、annual-center.csv、annual-double_buckle.csv、annual-single_buckle.csv：四产品逐期明细。每产品 11 期 × 49 个字段，共 2,156 行；同时列来源、原单位、缓存值、规范化 coefficient/scale 和网站值状态。CSV 是查看用导出，精确交换以 JSON 为准。
- validation.json：独立核对结果、检查数及历史异常位置；excel-controls.json：四产品逐年与全期、合并现金流及原件回报的私有对照。
- source.json：仅本机保留的原件路径及指纹；receipt.json：确认回执与导入前备份位置。

## 输入与对照边界

四个稳定产品键沿用 outboard、center、double_buckle、single_buckle。期间保留 Year 0 与 2019–2028，Year 0 的 ordinal=0、calendarYear=null，不凭空指定投产前某一个日历年。版本 As of 使用本地建档时明确指定的档案日期，policy.rules.asOfBasis 说明它不是已确认实绩截止日。

| 来源 | 导入内容及约束 |
|---|---|
| 四张 Financials | 逐期销量、单位售价/材料/人工/厂费、全成本收入及 MPBITRI、增量 CBT、投资/补偿、NWC、现金流、累计及换汇；另保留 P01 全部定位范围和总计控制。原始空白、字符串空格、错误及缺缓存分别保留。 |
| 八份市场 BOM | H:AF 范围的原字段、M 用量、AA 单价、AB 原币、AC 落地成本行贡献、AD 模具成本及总计。AC 是原表行贡献，后续不得不加辨别再乘 M。原币不明时保留原字段，不伪造规范化币种。 |
| AME | 六条线体的人数、CT、OEE、利用率、现有/新线/工装；全部标记为设计假设。单/双锁扣沿用各自 cyclesPerUnit，不能把双锁扣的工序次数漏掉。 |
| Hourly Rate / OH / OH-2017 | 隐藏费率表仍读取，保留实际引用、旧表参考与外链缓存身份；Financials D590、C640 分别保留小时费率与单件人工。设备 OEE、人工效率和利用率分别存原字段。 |
| DV cost / PV cost / PM | DV 包含样机/夹具，保留人时、包价及 EUR/CNY。PV 的 V:X 是 DV 覆盖项，Y 合计公式不含这些项。PM 保留 G/I/J/K 分项、EU/NA 分半和原始 EUR 换算除数，按产品归属；不能把 DV/PV 细项与 PM 汇总再加一遍。 |
| 客户补偿 | Financials 427、430 分期及件价摊回提案均保留来源；工程补偿和投资补偿独立。预算现金预测不改写成已经到账的 recovery / payment 实绩事件。 |
| 外链及名称 | 57 个依赖按 workbook.externalReferences 中的序号绑定 [n]，记录目标、缓存部件摘要、原件摘要及 refreshed=false；全局/局部命名定义分别保留。仅访问 ZIP 内缓存，不打开外部文件、不刷新链接。 |

50 张工作表中，四个启用产品按实际业务量识别，另外九张 Financials 作为无贡献模板核验后排除，隐藏状态随清单保留。隐藏的 Hourly Rate、Consolidation 不按模板排除。模板范围与现金贡献由 P01 检查进一步验证。

来源的 metadata.raw 保存 XML 原值、原公式、共享属性与锚点；metadata.excel 保存解码后的值、缓存状态及相对引用还原后的公式。共享公式的原始空文本与其有效公式分开，不能把锚点公式直接套给其余行。命名定义以独立来源行保存，包括局部作用域，避免只留下名字而失去外链去向。

规范化数值使用 P04 的 coefficient / scale。千 CNY、千 USD 转主单位按 1000 换算，金额按币种两位定点；千件销量依 P01 解回整件，单价和比率最多保留 12 位小数。换算与十进制舍入均不用 JavaScript 浮点。来源原精度和缓存始终保留，可独立复核舍入前值。导入金额按 P01 的金额容差核验，币种、方向、期间、产品集合及缺数状态不使用容差放行。

规范化输入名使用 cqa.* 命名空间，conversion.role 区分 source_literal 与 excel_cached_control，不能把后者当作网站计算结果。例如 cqa.cqa_full.mpbitri 对应 P01 的 cqa.mpbitri 对照，cqa.cqa_incremental.cbt 对应 cqa.cbt，cqa.cqa_incremental.cash_flow 对应 cqa.cash_flow。revenue / npv 等网站输出仍须由 P06 计算并带来源；operating_profit / EBIT / NOPAT / FCFF / ROIC 的未签认映射仍为 pending_finance。

规范化后的金额控制值按货币精度入库，原缓存可能含更高的中间计算精度。P06 对表必须从保留的原精度来源合计后再按 P01 舍入，不能把逐行已舍入的缓存控制当作业务计算输入。真实业务驱动、缓存对照和最终网站输出须继续分别使用。

## 已核验与仍未解释

独立校验先运行 P01 的范围、182 个控制格指纹、BOM、人工、开发分配、全成本/增量、逐期现金及合并回报检查，再用 Python Decimal 逐个比对导入原值、原公式、缓存和规范化值。核对使用 ZIP 原件与导出的候选，校验过程不读网站计算结果。

本次 3,441 个规范化输入与独立转换一致。21,939 个选定原始格的原值与原公式逐格核验；其中 14,156 个数值缓存独立比对通过。包括命名定义、工作簿清单和外链快照在内，共保存 25,320 个来源记录。四产品的各年及全期、Exec Sum 合并现金和原件回报通过 P01 技术核对。

以下 11 项作为 historical_unexplained 留存，不改写成零：

- Exec Sum 尾部空格原表的 U61、U64、U67、U70、U71、U72、U77、U78、U79、U81 缺少公式缓存。
- 1-2# RR OTB_SPR4.1 Reverse (EU)!AF30 是备注字段的 Excel 错误。

它们未使已锁定的四产品/合并财务控制检查失败。差异清单仍明确列出位置，不宣称原工作簿无任何错误。网站计算与 Excel 的差额目前为 null / not_implemented，绝不把“尚未实现”记成零差异。

工位测时、样机/验证批次和实际发生/支付仍为 to_collect；网站标准经营口径仍为 pending_finance。events=[]，没有从预算制造实际凭证或支付流水。现场测量和确认支出须后续按 P09/P10/P12 的业务证据补录。

## 导入事务、权限及重复处理

本步复用 schema 11 的来源、输入、版本、变更集、审计和回执，未改写旧迁移或增加第二套项目。专用离线契约把来源/输入集合上限扩到每类 50,000 行；读取已存快照使用相同上限。原有 HTTP 创建/PUT 的 2,000 行与 1 MiB 上限保持不变，大版本不能通过分批 PUT 形成半版。P06/P07 后续应使用专用读取/编辑契约。

预览必须选择空草稿，绑定 DATA_DIR、永久操作者、项目、版本、revision、stateRevision、源指纹和规范化快照摘要。预览只写私有暂存文件，不写财务源行或金额。独立校验绑定候选文件的 SHA-256。确认要求用户提供预览摘要，并再次核对原件指纹、候选文件、当前角色与项目能力。

确认采用一个 BEGIN IMMEDIATE 事务提交全部来源/输入、冻结状态、基线指针、修订、变更集、通用审计和幂等回执。需要 financeRead、financePreview、financeVersionEdit、financeApprove 及涉及模块的职责录入能力；Viewer、撤权账号及越项目访问不能确认。入口仅为离线 CLI，未开放接收大快照的公共 HTTP 路由。

幂等键由项目 + 目标版本 + 源指纹 + 映射版本组成。行键由稳定工作表身份 + A1，或产品/期间/字段组成，文件名不作为身份。同一预览确认重试返回原回执，逐表数据不变化。冻结目标不重新导入；新档案或新的财务版应选新空草稿。相同显示名、不同源内容在不同目标版本独立保存；没有经 P01 重新批准的指纹，CLI 直接拒绝，不能仅凭同名覆盖。部分源行失败、晚于指针更新的审计失败、并发修订或基线指针变化均整笔回滚。

同名文件回归使用两个目录中同名、不同内容的虚构工作簿，验证整文件指纹拒绝错版及 CQA_SAMPLE_XLSX 优先级。P05.1 的行键针对已经冻结的 P01 布局；后续档案如插入/移动物料行，须先更新映射版本并按原料号等业务身份匹配，不能把相同 A1 自动解释成相同业务物料。

离线 CLI 使用现有 DATA_DIR 目录锁，要求目标服务停止占用。第一次确认前走现有完整备份机制，释放备份锁后重新获取离线锁并重查权限及修订；中间有其他写入会被修订校验拦截。原回执重放不另做备份。工作树验证备份的代码标签明确包含 +P05-working-tree；正式发布的代码/数据配对仍属 P15。

本次实测重复确认的回执及逐表证据一致；导入后完整备份并恢复，来源、定点金额、版本、审计、回执和非财务表的摘要一致。原件导入前后整文件指纹一致。

## 可重跑命令

在仓库根目录，用 Node.js 24+ 与 Python 3.10+。优先读 CQA_SAMPLE_XLSX；未设置则按 P01 在授权 F 盘目录定向查找并匹配完整指纹。CQA_PYTHON 可指向本机 Python，否则使用已安装的 Codex bundled Python，再回退 python3。

完整授权样本验证，在新的本地私有目录自动准备空目标，依次预览、校验、确认、重试及备份恢复：

    node --experimental-strip-types scripts/verify-finance-p05.ts --record

对已经明确选定的现有本地项目/空财务草稿，分别执行；把尖括号参数替换为实际值，不要将真实候选放进公开目录：

    node --experimental-strip-types scripts/import-finance-cqa.ts preview --data <DATA_DIR> --actor <login> --project <projectId> --version <emptyDraftId>
    node --experimental-strip-types scripts/import-finance-cqa.ts validate --data <DATA_DIR> --actor <login> --preview <previewId> --digest <previewDigest>
    node --experimental-strip-types scripts/import-finance-cqa.ts confirm --data <DATA_DIR> --actor <login> --preview <previewId> --digest <previewDigest>

preview 返回明确的冻结动作、计数及本机输出位置；validate 返回独立检查及历史异常数；confirm 返回版本和基线回执。必须先阅读预览和校验。该命令不新建账号、不猜测业务项目、不运行生产发布。

不依赖原件的虚构回归与完整检查：

    node --experimental-strip-types --test tests/finance-cqa.test.ts
    node --experimental-strip-types scripts/check.ts

下一步 P06 可从冻结版读取原始驱动、缓存对照和来源，完成真正的分期共用计算与预览；P07 再将数据接到已选 A 版英文网站界面。
