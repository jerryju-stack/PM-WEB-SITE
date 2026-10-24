# A 批次写入、版本与迁移契约

## 写入入口

HTTP 项目/文章写入统一调用 lib/resources.ts 的 resourceWriter；任务写入调用 lib/task-writes.ts 的 writeTasks，再由 saveTasks 在事务中保存。不要在新路由使用通用 store.put/remove 或裸 SQL 替代这些入口。store.put 仅保留初始化、测试夹具和任务派生字段内部写入。

- POST /api/projects 或 /api/articles：创建，不带 id，初始 version=0。
- PATCH /api/projects/:id 或 /api/articles/:id：更新，携带 version。PUT 使用相同更新规则。
- DELETE 同一资源路径：携带 version；项目还必须携带读取时的 taskRevision。
- GET 同一资源路径：登录后读取完整最新记录。/api/data 列表也包含版本。
- 兼容旧 collection POST-with-id/DELETE-with-id，但只执行带版本的更新/删除；绝不把不存在的 ID 当创建。不带必需版本返回 409 和刷新提示。
- 存在性检查优先：更新/删除不存在的资源返回 404；存在但缺版本、版本过期或项目删除时任务版本不匹配返回 409。所有检查与写入在 BEGIN IMMEDIATE 事务中完成，更新还使用 WHERE id=? AND version=?。

项目 version 只记录基础信息变化；既有 projects.revision 保留为任务排期版本，读取时映射为 project.taskRevision，Timing 响应中的 revision 仍为同一任务版本。新库、旧 SQLite 升级和 JSON 导入的项目/文章 version 都从 0 开始，既有任务 revision 不重置。

项目任务编辑不会增加基础信息 version；基础信息编辑不会增加任务 revision。这样两者可以交错提交，而不是无意义地互相冲突。项目删除同时检查两种版本，避免删除他人刚改过的任务。

项目可写字段为 title/description/category/date/startDate/owner，date/startDate 是用户填写的项目计划日期，不是任务日期汇总；更新会保留未提供字段。progress/status 在任务存在时由排期计算更新，项目写入入口不接受其旧值覆盖；content 和其他只读字段同样不能从项目编辑写回。本批不改变既有暂停/进度与任务转父级的业务规则。文章可写 title/description/category/date/content。

输入在 lib/contracts.ts 运行时校验，不依赖 TypeScript 断言代替验证。版本必须为非负安全整数，taskWrite.revision 必需，叶子工期仍限制 0–2600（普通任务 0 规范为 1），里程碑为 0。阶段工期、日期和完成度从子任务重算，不校验旧派生工期的叶子上限。阶段累计原始权重及加权总数，最终百分比才取整；项目与阶段共用同一计算口径，空阶段权重 0、未排期叶子仍参与、里程碑权重 1。

## 冲突与客户端

不自动更新版本后强行重试。保留草稿，查看最新数据，然后由用户明确决定舍弃还是以最新版本人工重新提交；再次竞争仍会返回 409。成功提示必须以写入成功为准。页面输入的草稿与服务端快照分离，未保存离开/刷新需明确处理。草稿不跨设备同步。

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

项目/文章表单在提交期间禁用相关输入，失败保持原始 DOM 输入。Timing 的任务草稿按当前用户与项目保存在页面内存，原始表单值另行保留，避免把暂时为空的数字字段重绘成 0。附件重新加载、视图重绘以及同页重新挂载不会直接替换 dirty 草稿。离开编辑对象有舍弃确认；刷新/离开页面使用 beforeunload 提示，明确选择离开后不承诺恢复。草稿不写入服务器、不跨设备，亦非浏览器永久存储。

Timing 保存中统一锁定编辑；未获接受的操作有明确等待反馈。失败的表格修改进入可恢复抽屉；拖动失败预览保持开始、结束和工期一致。完成度按持久化数值的十进制表示精确累积（内部临时 BigInt），最终取整为普通数字；不会把 BigInt 写入 JSON 或数据库，不引入新依赖。

项目暂停与进度关系、任务转父级历史处理沿用原逻辑，仍是后续业务确认事项。附件文件/数据库崩溃一致性、团队授权、创建幂等及完整恢复平台均未在本批实现。

Timing 的异步读取使用 src/drafts.ts 中的 ReadGuard：新读取取代旧读取，开始写入立即使先前读取失效；最新值查看还绑定发起时的草稿对象及挂载生命周期。过期响应不得替换快照、给另一个任务选择版本或清除草稿。此守卫不替代服务端版本检查，也不自动授权重试。最终复核的通过范围及原生对话框人工验收条件见 batch-a-validation.md。
