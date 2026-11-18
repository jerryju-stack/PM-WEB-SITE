# Project Station 写入、查询与迁移契约（A–E）

## 写入入口

HTTP 项目/文章写入统一调用 lib/resources.ts 的 resourceWriter。D8起，Timing 任务写入由 timingDrafts.mutate 调用任务校验及排期并保存共享草稿；只有采用将草稿任务、历史与回执在同一事务写入执行计划。不要在新路由使用通用 store.put/remove 或裸 SQL 绕过这些入口。store.put 仅保留初始化、测试夹具和任务派生字段内部写入。

- POST /api/projects 或 /api/articles：创建，不带 id，初始 version=0。
- PATCH /api/projects/:id 或 /api/articles/:id：更新，携带 version。PUT 使用相同更新规则。
- DELETE 同一资源路径：携带 version；项目还必须携带读取时的 taskRevision。
- GET 同一资源路径：按资源读取权限返回完整最新记录。/api/data 返回必要摘要及版本，正文按需读取，不能从摘要构造缺少字段的编辑快照。
- 兼容旧 collection POST-with-id/DELETE-with-id，但只执行带版本的更新/删除；绝不把不存在的 ID 当创建。不带必需版本返回 409 和刷新提示。
- 存在性检查优先：更新/删除不存在的资源返回 404；存在但缺版本、版本过期或项目删除时任务版本不匹配返回 409。所有检查与写入在 BEGIN IMMEDIATE 事务中完成，更新还使用 WHERE id=? AND version=?。

项目 version 只记录基础信息变化；projects.revision 是正式执行任务版本，映射为执行计划的 project.taskRevision。D8 Timing 带有效租约读取共享草稿时，响应 revision 是草稿修订，executionRevision 单独返回执行修订；草稿ID、租约token、草稿修订不能与执行版本混用。新库、旧 SQLite 升级和 JSON 导入的项目/文章 version 从 0 开始，既有任务 revision 不重置。

项目任务编辑不会增加基础信息 version；基础信息编辑不会增加任务 revision。这样两者可以交错提交，而不是无意义地互相冲突。项目删除同时检查两种版本，避免删除他人刚改过的任务。

项目可写字段为 title/description/category/date/startDate/owner，date/startDate 是用户填写的项目计划日期，不是任务日期汇总；更新会保留未提供字段。progress/status 在任务存在时由排期计算更新，项目写入入口不接受其旧值覆盖；content 和其他只读字段同样不能从项目编辑写回。本批不改变既有暂停/进度与任务转父级的业务规则。文章可写 title/description/category/date/content。

输入在 lib/contracts.ts 运行时校验，不依赖 TypeScript 断言代替验证。版本必须为非负安全整数，taskWrite.revision 必需，叶子工期仍限制 0–2600（普通任务 0 规范为 1），里程碑为 0。阶段工期、日期和完成度从子任务重算，不校验旧派生工期的叶子上限。阶段累计原始权重及加权总数，最终百分比才取整；项目与阶段共用同一计算口径，空阶段权重 0、未排期叶子仍参与、里程碑权重 1。

## 冲突与客户端

不自动更新版本后强行重试。保留本地输入，查看最新数据，再由用户明确决定恢复或放弃；再次竞争仍会返回409。成功提示以写入成功响应为准。共享草稿可供有权限账号在新租约下继续，本地未提交输入与其分离且不跨设备同步。采用/确认响应丢失是结果未知，应重读核对；已收到成功而重读失败是已确认写入，不能重新报为写入失败。

## 编号迁移

lib/migrations.ts 管理 schema_migrations。001 resource_versions 增加 projects.version 和 articles.version，默认 0，不改变任务/依赖/附件记录。旧结构仍由原建表逻辑兼容初始化，再按编号迁移；JSON→SQLite 的备份与事务导入路径保留。每一步 DDL 与迁移记录同事务提交，失败回滚本步，下次启动重试。新于代码所支持的迁移版本明确拒绝启动。

部署操作（本轮没有执行）：停写、停止旧进程，备份同一时点数据库及 uploads（必要时包含 WAL/SHM），保留匹配代码版本；在副本先启动新代码并检查迁移与关键流程，再按发布流程切换。应用启动自动升级 DATA_DIR，正式数据目录必须由部署者明确指定；不要用预览夹具覆盖正式数据。

## 回退限制

只回退代码与恢复数据是两件事。原始 4724e4b 不知道新版本契约，会进行无条件写入；即使新增列不影响它读取，也不能认为可安全恢复旧程序写入。尚未产生新语义写入时，可在停写后恢复迁移前配套代码/数据；一旦已有新语义数据写入，应停写并使用配套代码与完整数据/附件快照恢复，或制定经验证的兼容迁移。仅 git revert 不能安全回退。快照之后的数据需要单独处理，不应被宣称自动保留。

## 检查

pnpm install --frozen-lockfile 后运行 pnpm check；本机也可 node --experimental-strip-types scripts/check.ts。入口执行类型检查、全部 Node 隔离测试、工作区/暂存区及当前提交差异检查。项目无独立构建命令，浏览器脚本仍由服务端移除类型提供。

Git origin 为 GitHub，.github/workflows/check.yml 使用 Node 24、pnpm 11.25.0、锁文件安装后调用同一入口。本地通过不等于远程 CI 通过；未推送/未运行远程任务时需分别说明。

## 本地草稿的实现边界

src/drafts.ts 的 EditDraft 保存独立副本、读取时版本、dirty 状态与最新值候选。review 仅展示候选，useReviewedVersion 仅在用户点击明确按钮时改变下一次提交版本；仍需再次点击保存，不自动发送旧数据。再次冲突后必须重新查看新值。

项目/文章表单在提交期间禁用相关输入，失败保持原始 DOM 输入。Timing 的原始行内/抽屉输入独立保留，暂时为空的数字不重绘成0；按稳定用户UUID与项目使用标签页 sessionStorage 保存恢复副本，受阻时回退为内存。失租后重新授权、新租约和最新读取均成功，才展示比较并让用户恢复或放弃；恢复只回填，须手动保存。后续登录账号不能读取旧身份副本。失败/未决离开检查不得改变选择、值、焦点或抽屉关闭状态，重复Escape只完成一次关闭。刷新尽力恢复；关闭标签页/清理存储后不承诺保留，不提供跨设备本地输入同步。

Timing 保存中统一锁定编辑；未获接受的操作有明确等待反馈。失败的表格修改进入可恢复抽屉；拖动失败预览保持开始、结束和工期一致。完成度按持久化数值的十进制表示精确累积（内部临时 BigInt），最终取整为普通数字；不会把 BigInt 写入 JSON 或数据库，不引入新依赖。

项目暂停与进度关系、任务转父级历史处理沿用原逻辑。A时点的附件/团队权限/恢复边界已由B/C及D8/E补充，当前能力以各批验证与下列契约为准；不将旧批次限制误作当前状态。

Timing 的异步读取使用 src/drafts.ts 中的 ReadGuard：新读取取代旧读取，开始写入立即使先前读取失效；最新值查看还绑定发起时的草稿对象及挂载生命周期。过期响应不得替换快照、给另一个任务选择版本或清除草稿。此守卫不替代服务端版本检查，也不自动授权重试。最终复核的通过范围及原生对话框人工验收条件见 batch-a-validation.md。

## E 查询与历史

`GET /api/data` 默认每类24条，limit=1..100，q/status/category 作用于授权摘要；projectsCursor/articlesCursor 分别续页。返回 projects、articles、projectsPage/articlesPage.nextCursor、授权范围内 stats、users=[]；项目卡片与文章摘要不含正文。完整详情按ID读取。admin账号页面调用 `/api/users?limit=24&cursor=...`；无分页参数的旧全量入口只为admin兼容。前端不能把后续页数据永远截断。

`GET /api/projects/:id/timing/versions` 默认50条、limit=1..100，按 saved_at DESC,id DESC 游标续页，SQL排除软删除，不读取snapshot。游标绑定项目/查询范围，非法或跨范围返回400。比较、导出及删除/撤销消费相同元数据，指定ID详情仍单独查权限与删除状态。指纹只筛选等价历史候选，最终仍做语义比较，碰撞、缺失旧索引、元数据及软删除不改变归档语义。

迁移9添加元数据页索引与历史指纹侧表，迁移10添加独立摘要投影和同步触发器；不重写历史快照、不制造版本或修改旧资源修订。旧数据首次回填成本与规模有关，需在停写副本预演。权限上下文只在单个同步请求内复用，不跨await或跨请求缓存撤权结果。

## E 异步文件与最终提交

HTTP文件入口先限流，固定执行计划/明确历史或草稿快照，再交给复用有界worker。默认2活跃/8等待/10秒总期限；上传8MiB，任务/结果各32MiB、等待载荷64MiB；worker不打开SQLite。配置、V8 heap与RSS区别见E-B记录。无同步CPU兜底或每请求无限创建线程。

每次await后重查当前session/稳定UUID/authEpoch、项目能力、取消/停止/绝对期限。导出发送前重新授权，合法并发修改不改变开始时的文件快照/文件名。预览/确认还复查草稿ID/修订、项目version/执行revision、租约token/持有人/有效期、预览所属/内容/期限；检查到最终主线程事务之间无await，序列化后再查时间边界。确认只写共享草稿；执行计划、指定历史与现有采用语义不变。

确认及采用使用既有receipt幂等语义；旧租约/账号不能重放其他会话的回执。取消/超时/异常的未提交结果不落库；已提交但响应丢失不能保证撤销，应重读或以同一有效会话请求键核对。前端保留未确认预览，不自动重试。

错误：队列满429、文件/任务超限413、输入400、修订/租约/预览过期409、worker故障/停止503、总期限504；429/503带Retry-After:2。断连/取消内部499，已断连接不再写响应。导出沿用文件名清洗、Content-Disposition、格式Content-Type、private no-store及nosniff。工作簿签名密钥不进日志/指标/证据，worker只接收必要密钥且错误脱敏。

迁移9/10后的回退须使用迁移前完整快照及配套代码；D9旧代码明确拒绝新schema，不能只回退代码。恢复、旧会话失效及有效租约占用行为见 `batch-e-validation.md` 与 `batch-c-operations.md` 的E补充。
