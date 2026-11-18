# P04 数据、权限与版本契约

2026-11-17 · P04.1 · schema 11 · 仅使用虚构夹具。承接 [P01 指标字典](../P01/metric-dictionary.json) 与 [P01 来源矩阵](../P01/source-matrix.json)。

本步完成持久化、服务端权限、版本与审计边界。业务计算、Excel 导入和正常网站真实财务页面分别交给 P06、P05、P07。P03 仍使用标识为 Sample 的浏览器夹具，P04 的接口数据不会自动显示到 P03 页面。

## 存储及稳定键

| 实体 / 表 | 主键及约束 | 约定 |
|---|---|---|
| 既有项目 projects | 复用原 project.id | 不建立第二套项目身份，不从标题或客户名生成项目。 |
| finance_versions | 全局 UUID id；UNIQUE(project_id,id)；parent_id 与项目构成外键 | 草稿克隆使用新 UUID；parent 指向同项目原版本。revision 是财务内容修订，独立于项目 version 与 taskRevision。 |
| finance_products / finance_markets / finance_lines / finance_periods | (project_id,version_id,stable_key) | 同一实体跨版本沿用 key，标签可改。外部键、工艺版、期间起止等保存在 metadata。不能将名称、排序或 Excel 行号单独作为身份。 |
| finance_sources | (project_id,version_id,stable_key) | system + externalKey 标识外部行；fingerprint 固定来源修订；sheet/cell 保留原表定位。源行可被多个输入引用。 |
| finance_inputs | (project_id,version_id,stable_key) | module + metricKey + 产品/市场/线体/期间/来源构成业务语义；各维度通过含项目与版本的复合外键约束。不得把这些外键指向其他版本。 |
| finance_events | 同上 | 每次预算、发生、支付、补偿回款和 ETC 分开编号；关联不是同一行覆盖。 |
| finance_project_state | project_id | approved_baseline_id 与 current_version_id 独立；revision 是项目财务指针修订，API 使用 stateRevision。 |
| finance_changes | UUID id | 追加式变更集，保留操作、原因、永久身份、旧/新修订、完整规范化快照和 SHA-256。 |
| finance_receipts | (project_id,actor_uid,request_key) | 操作与规范化请求摘要、原结果一起提交；同 key 改内容返回 409。 |

key 仅接受 1–160 个字母、数字、下划线、点、冒号及连字符，首字符须为字母或数字。排序只影响规范化输出；期间顺序使用 metadata.ordinal，必须是唯一非负整数。现金流起算期 policy.cashFlowOriginPeriod 必须指向 ordinal=0 的期间。输入表支持空 productKey / marketKey / lineKey，表示明确的项目共用项；periodKey 与 sourceKey 必填。缺数据不自动写成金额零。

P05 应直接沿用 P01 产品键 outboard、center、double_buckle、single_buckle，期间键建议 year-0、year-2019 … year-2028；市场、线体沿用来源中的稳定编号。source.key 使用“来源类别＋稳定外部行/字段身份”，例如 ame:line-01:ct；sheet/cell 是来源位置而非唯一身份。克隆版本保留全部稳定键和外部键。新导入档案必须重新记录 fingerprint，不能用同名文件覆盖历史来源。

## 精度、来源与换算

共享 TypeScript 契约在 lib/finance-contracts.ts，并从 lib/contracts.ts 导出类型；样例为 tests/fixtures/finance-p04.ts。所有 value / amount 使用：

    {"coefficient":"12345","scale":2}

表示 123.45。coefficient 是规范化的十进制整数字符串，最多 60 位，允许负数，不允许浮点、指数、前导零或 -0。SQLite 存 TEXT，不经 JavaScript Number。scale 为 0–12；money 与所有事件 amount 必须等于版本 policy.currencyScales 中相应币种的精度；unit_price / rate / quantity 可保留更高精度。报告 currencyScale 必须与同一策略一致。币种采用三个大写字母；币种精度是版本明确配置（0–4），不按字母猜测。夹具覆盖 CNY/USD=2、JPY=0、KWD=3；企业币种建档须财务确认。

currency 表示该输入或事件的币种，版本 currency 是报告币种，两者不被静默混同。千元转主单位、汇率换算、税口径及分摊通过 input.conversion 和 policy.rules 保留依据，源值用 coefficient/scale 表示。建议 conversion 保存 sourceValue、sourceUnit、multiplier、fxRate、fxSourceKey、effectiveDate、rounding；原表千元保持 source.originalUnit，不能只留下换算后的数。P04 验证类型与引用，不执行或认证这些换算；P05/P06 必须校验并使用实际规则。

source 必填 owner、originalUnit、originalPeriod、effectiveFrom；originalCurrency 可为 null，sheet/cell/fingerprint 也可为 null，但不得伪造位置或实测身份。effectiveTo 为含端点的日期或 null，须不早于 effectiveFrom。日历日期严格校验。原期间、源修订、外链身份、缓存/公式及待采信息可留 metadata。来源 observation 枚举 measured / design / budget / cached / unknown，只有具备本批测量或确认实绩证据才可写 measured；P01 AME 为设计假设。mappingStatus 兼容 P01 的 mapped、cached_external、reference_only、pending_finance、to_collect 以及指标字典中的衍生/历史口径状态。

basis 分为 website / cqa_full / cqa_incremental；dictionaryVersion 与 calculationVersion 每版必填。P04 夹具使用 P01.1 和 not_implemented。P01 已锁定的 Year 0、年末现金流、有效年折现率、IRR 异常、首次回收及峰值口径、显示四舍五入与核对容差继续有效。policy.rounding 固定 half_away_from_zero，详细折现与现金时点依据放 rules。P06 对规则及异常作业务验证；本步不返回计算结果。

## 独立的财务事件

| kind | 表示 | 后续使用边界 |
|---|---|---|
| budget | 某期间和业务范围的预算安排 | 批准版本提供预算基准，不等同已发生或已支付。 |
| incurred | 服务/货物已发生的来源事件 | 日期与验收/凭证独立；P12 再实现成本草稿、独立确认、调整与审批状态。P04 存储记录本身不替代成本确认。 |
| payment | 资金支付事件 | eventDate 可以晚于发生日；relatedKey 如填写，必须指向同版本 incurred 事件。 |
| recovery | 客户补偿/其他回款事件 | 保留到账证据；不把合同额、应收与实收自动相加。 |
| etc | 截至期后的剩余预测 | 后续按范围衔接实绩，不能把已发生项重复计入剩余预测。 |

每条事件有单独 key、金额、币种、来源、期间及 evidenceKey。预算可暂时只有期间且 eventDate=null。relatedKey 必须指向同版本的其他事件，禁止自关联及循环。预算、发生与支付不会在 P04 合计为“成本”。付款分次可多行关联同一发生行。跨期更正、已确认成本不可改、录入与审批分人等是 P12 的附加约束；本步仅冻结完整版本，不宣称实现 P12 确认流程。

## 草稿、基线、当前预测及证据

创建版本不自动选作基线或当前预测。PUT 使用完整 snapshot 替换草稿，必须携带当前 revision、requestKey 和 reason；删除行也通过完整候选明确表达。删除顺序、全部源/维度/输入/事件、revision、变更集、通用审计和回执在同一 BEGIN IMMEDIATE 事务提交。失败无半行或半版本。

freeze 要求 financeApprove，校验 revision 与 stateRevision，将草稿变为 frozen，同时更新批准基线指针。currentVersionId 保持原值，activate 是独立动作。冻结后的版本与子表禁止 INSERT/UPDATE/DELETE；不能原地解冻。需要改动时以原版 id、parentRevision 和新 snapshot 创建草稿。activate 需要 financeVersionEdit 及两个修订号，可选草稿或冻结版。只有指针改变时，冻结版内容 revision 不增加，stateRevision 增加。旧基线仍冻结可读。

同一项目不同版本的并发批准/切换通过 stateRevision 发现冲突。并发草稿写使用 revision；冲突 409，不自动覆盖。requestKey 在同项目同永久账号内跨操作唯一。规范化请求的对象键顺序不影响摘要，数组顺序仍属于请求身份；同 key 同操作同内容返回原回执，不二次写入。重放前重查当前账号与所需能力，撤权后不能靠旧回执继续访问。原回执中的指针代表当时提交状态，客户端随后 GET 重读当前指针。

审计 actorUid 从当前永久账号确定，调用方提供的 actorId 不能冒充其他用户。通用 audit_events 记录修订、快照摘要和 changeSetId；finance_changes 保存完整前后快照、原因和来源。changes / receipts 追加后不可修改或删除。带财务历史的项目不允许硬删除，返回 409，以保留依据；迁移后的空财务项目仍按现有规则删除。

## 能力与服务端边界

现有用户身份、项目成员组与管理员角色全部复用。系统新增组不自动添加成员，原 editor / manager / viewer 组不获得财务权限。

| 能力 / 组 | 允许 |
|---|---|
| financeRead / finance-reader | 指定项目财务版本、源行和变更集读取；不继承项目卡公开可见或 Timing 的 authenticated 可见范围。 |
| financePreview | 调用候选结构校验；改动仍需相应录入能力；原样候选可只读校验。 |
| financeVersionEdit | 创建版本、编辑名称/口径/策略/维度/来源元数据、选择当前预测；填充新版本内容还需所有涉及模块的录入能力。 |
| financeApprove | 冻结并采用批准基线；不隐含业务录入。可以建仅 financeRead + financeApprove 的审批组。 |
| finance-controller | 全部财务能力，适合项目财务负责人；授予范围仍是项目成员关系。 |
| finance-commercial / finance-bom / finance-operations / finance-factory / finance-engineering / finance-prototypes / finance-validation / finance-investment / finance-returns / finance-budget | financeRead + financePreview + 对应的单一 *Edit 能力，覆盖十个业务职责。 |

对应能力名依次为 financeCommercialEdit、financeBomEdit、financeOperationsEdit、financeFactoryEdit、financeEngineeringEdit、financePrototypesEdit、financeValidationEdit、financeInvestmentEdit、financeReturnsEdit、financeBudgetEdit。跨模块移动一行必须同时拥有旧、新职责；共同元数据修改需要 financeVersionEdit。Viewer 即使加入 finance-controller，角色上限仍禁止全部编辑、创建、采用和审批；有 financePreview 时可原样校验，不能提交或预览改数。只含 financeRead 的编辑角色也不能用原样 PUT 制造写入。

现有 admin 在服务端拥有全部能力。测试中的目标管理员是独立 DATA_DIR 中由现有初始化机制生成的真实 admin 身份；没有访问生产账号。服务每次按 uid 重新读取活跃账号及成员关系，慢请求收完 body 后 server.ts 再核对 session。停用、降权、删除成员或改职责立即生效。未登录 401；无财务查看权限、跨项目/不存在的版本统一 404；已获查看但缺职责返回 403。公共 /api/data 继续只提供项目卡字段，不带金额、源行、版本、基线或财务指针。财务项目列表有独立鉴权。

## HTTP 交接矩阵

下表基路径为 /api/projects/:projectId/finance。全部接口使用现有 session cookie。

| 方法 / 路径 | 请求 / 返回 |
|---|---|
| GET /api/finance/projects | 仅返回有 financeRead 的项目 id/title 及当前财务指针。 |
| GET 基路径 | projectId、state=empty/ready、versions 摘要及两个指针、stateRevision。旧项目没有伪造空金额。 |
| POST /versions | {requestKey,reason,snapshot,parentId?,parentRevision?} → FinanceWriteResult；创建返回 201，幂等重放保持原语义。 |
| GET /versions/:id | FinanceVersionSummary + snapshot + FinanceProjectState。 |
| PUT /versions/:id | {requestKey,reason,revision,snapshot} → FinanceWriteResult。只允许草稿。 |
| POST /versions/:id/preview | 同 PUT 请求；返回 revision、candidateSha256、逐行 changes、persisted=false、calculationStatus=not_implemented。无回执/审计/数据写入。 |
| POST /versions/:id/freeze | {requestKey,reason,revision,stateRevision} → FinanceWriteResult。 |
| POST /versions/:id/activate | 同 freeze，请求独立明确表达采用当前预测。 |
| GET /versions/:id/changes | 完整私有变更集与前后快照；受 financeRead 保护。 |

FinanceWriteResult 含 ok、id、projectId、revision、status、changeSetId、snapshotSha256、approvedBaselineId、currentVersionId、stateRevision。未知合同字段返回 400；日期、枚举、重复 key、单位精度及同版本引用校验也返回 400。修订和幂等冲突返回 409。接口英文错误信息遵守已确认的财务语言。元数据是有界 JSON 对象（每项最多 20,000 字符），集合每类最多 2,000 行，HTTP body 沿用 1 MiB 上限；P05 如需更大原子导入应扩展专用导入契约，不能拆成会产生半版的多次 PUT。

## 迁移与备份恢复

本步开始时最新版为 schema 10，接续 migration 11 project_finance_contract。没有改写历史迁移。独立目录从既有 B fixture 经原迁移升到 10，先固定项目、文章、账号与修订，再注入第 11 步 DDL 后故障；验证财务表、组、迁移标记均回滚，再使用 openStore 升到 11 并重复启动。旧项目财务 state=empty，versions=[]，两个指针 null，stateRevision=0。

现有备份仍采用目录锁、SQLite checkpoint、数据库及附件/隔离区复制、manifest / COMPLETE 校验。schema 11 起，11 张 finance_* 表进入逐表 count + SHA-256；较早 schema 按原版本表集合验证。读取备份时还复核财务快照、变更摘要/修订链、回执归属、批准基线冻结状态及外键。恢复后逐表证据必须相同。不是降级 migration：回退到旧代码应按现有流程使用迁移前恢复点，旧代码无法直接打开 schema 11。

本步没有迁移真实 DATA_DIR、重启现有预览服务或连接远程生产服务器。P05 开始前对实际目标数据按现有机制做迁移前备份。

## 可重跑证据

在仓库根目录执行，Node.js 24+，不需要原始 Excel：

    node --experimental-strip-types scripts/verify-finance-p04.ts
    node --experimental-strip-types scripts/verify-finance-p04.ts --record
    node --experimental-strip-types scripts/check.ts

第一条只验证；第二条用虚构数据重新生成 migration-evidence.json 与 verification.json；第三条等价仓库 npm run check，包含类型检查、全套测试及 Git 差异检查。每次使用系统临时独立 DATA_DIR 与独立端口，记录文件不含本机临时路径或凭据。夹具采用通用虚构值，金额与 P01 私有 CQA 原件无关。

参见 [定向测试结果](verification.json)、[迁移及恢复证据](migration-evidence.json)、[完整检查](check-summary.json)。数据库测试覆盖两个独立连接的竞争修订、HTTP 同时提交、冻结与追加限制、审计和回执两种故障回滚，以及正在接收请求时撤权。全量备份恢复后财务与非财务逐表摘要一致。

P05 使用本契约存来源及四产品基线，补齐源指纹/原值/换算及原子导入；P06 实现真正的统一计算和预览；P07 接入选定 A 版英文界面。未决业务口径继续沿用 P01 清单，不能用数据库默认值代替财务签认。
