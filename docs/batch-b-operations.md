# Batch B 数据可靠性操作说明

仅支持 SQLite、单进程、本机文件系统。以下命令不会管理 systemd 或远端服务。实际 DATA_DIR、目标目录由操作员明确提供，不能在正式数据上故障注入。

迁移 002 增加 audit_events、attachments.sha256（旧记录保留 NULL）、file_jobs 及附件删除触发器。DDL 与版本标记同事务，失败不推进；重新启动重试。001 版本、项目 version 与任务 revision 保留。新语义写入后不能只回退代码，必须停写并恢复匹配代码和整套数据库/附件快照，快照之后写入不自动保留。

审计和业务 SQL 同事务，失败一起回滚。历史不外键关联资源或账号，删除后保留。actor_id 是当前可重用登录名，actor_name 是操作时显示名；不能视为永久人员 ID，C 批次需衔接不可重用身份。正文、备注、简介仅记录摘要/长度，不复制请求正文或凭据。审计没有自动撤销功能。

| 写入路径 | 覆盖 |
| --- | --- |
| 项目、文章 POST/PATCH/PUT/兼容 POST-with-id/DELETE | 创建、修改、删除，版本前后值 |
| 项目模板创建、任务新增/修改/删除/排期重算、级联任务删除 | 每个实际变化任务，关联项目与 revision |
| 附件上传登记、直接删除、任务/项目级联删除 | 附件元信息及摘要；与删除意图同事务 |
| 初始化、JSON 导入、迁移前历史、裸 SQL/内部 put、用户/密码/设置管理 | 不补造历史；不属于本批审计覆盖 |
| 文件维护和下载 | 文件操作保留隔离回执；下载不记成功业务审计 |

上传状态：持久化 upload 意图 → .part 写入并 sync → rename → 附件登记+审计+删除意图同事务。登记前崩溃会留下意图；启动重试移入 quarantine/jobs/ID。登记后崩溃保留正常附件。删除状态：业务删除+审计+触发器登记 delete 意图同事务 → 文件隔离 → 完成意图。隔离失败记录 attempts/last_error，重启或离线工具重试。返回删除成功意味着数据库删除成功，可能仍有待隔离字节。

隔离采用确定目标，rename 后崩溃可重入；目标冲突保留源并报告，不覆盖。附件隔离区无默认永久删除，磁盘占用需运营监控；30 天备份保留命令只管理独立备份根的已登记快照，不清空附件隔离区。正常服务仅在启动时处理遗留任务、请求完成后处理本次任务，不扫描其他在途上传。全量重试、对账及孤立文件隔离只能在独占离线锁下执行。旧 sha256=NULL 附件按字节数检查，备份另对全部文件计算摘要；不能证明旧记录在首次备份之前未被等长篡改。

服务持有 DATA_DIR/.station-lock。维护工具使用同一锁，服务运行时拒绝执行。崩溃锁不自动抢占，unlock 仅在同主机且 PID 确认不存在时移除，PID 重用会保守拒绝。锁不防不遵守协议的旧程序、手工 SQL 或网络共享写入；首次从 A 切换必须由运维确认所有旧写入者已停止，并确保仅新服务/工具有写权限。

## 命令与一致性前提

统一入口 `node --experimental-strip-types scripts/data-maintenance.ts COMMAND`，所有参数均显式给值。下面用占位路径说明，不代表已授权任何生产操作。目标的父目录须存在。数据、备份和隔离导出目录应置于仓库外，仅授权运维人员可读写；包含用户哈希和业务信息的快照不得进 Git。

1. 停止接收新写入，结束全部服务、旧程序、任务脚本及手工 SQLite 连接，核对已知监听端口和所属 PID。只停止自己负责的进程。A 程序不认识新目录锁，`--offline-confirmed yes` 是操作员对旧写入者和直接文件写入也已停止的确认；不能仅凭 B 锁证明 A 已停服。
2. 若有崩溃遗留锁，执行 `unlock --data DATA_DIR`。同机 PID 存活时拒绝；无法识别的锁须人工核实，工具不会自动抢占或 kill 任何进程。
3. B 日常维护先 `reconcile` 查看，按需要 `retry` 处理已登记意图，再次对账，再做快照。先留一个故障现场快照也可以：快照完整保存 file_jobs、uploads（包括 .part）及 quarantine，恢复启动后按相同规则处理。缺失/损坏的被引用附件必须先查明，备份检查会拒绝，不可将其称为完好恢复点。无法解释的文件默认只报告，明确选择后才隔离。
4. `backup` 持锁整个 checkpoint/文件复制/校验阶段。SQLite checkpoint(TRUNCATE) 必须无 busy；数据库关闭后复制，再将副本规范为独立 DELETE journal 数据库，不依赖 WAL/SHM。源 WAL/SHM 由 SQLite 处理，不能手工删掉未 checkpoint 的 WAL。服务与 uploads 均停写，所以数据库与文件属于同一静止状态。
5. 工具生成 `.incomplete-UUID`，写入数据库、uploads、quarantine，再做完整性、外键、初始化/网站配置/可用登录账号、JSON/关系表示、依赖、版本、引用/摘要检查；记录全表行数与内容摘要、文件大小/SHA-256、格式/时间/配套代码/生成工具代码/迁移版本。最后移到目标并写 COMPLETE。可用账号结构检查不替代恢复后的实际登录。无 COMPLETE、清单不匹配或 `.incomplete-*` 不可恢复。失败保留现场供检查，不能将残留目录重命名当作成功备份。

```powershell
node --experimental-strip-types scripts/data-maintenance.ts reconcile --data 'D:\isolated\source' --offline-confirmed yes
node --experimental-strip-types scripts/data-maintenance.ts retry --data 'D:\isolated\source' --offline-confirmed yes
node --experimental-strip-types scripts/data-maintenance.ts backup --data 'D:\isolated\source' --target 'D:\snapshots\snapshot-001' --offline-confirmed yes
node --experimental-strip-types scripts/data-maintenance.ts verify --snapshot 'D:\snapshots\snapshot-001'
```

默认要求相关运行代码/工具已提交；不会将用户无关的 .gitignore/AGENTS.md 变更混入配套代码判断。备份也支持已停服的 A/001 结构，不执行迁移。升级前备份必须加 `--paired-code 31713b1`（实际使用经核对的 A 部署提交），并保存该 Git 提交及依赖锁文件；清单分别记录配套 A 提交和 B 工具提交。B 快照默认配套当前提交，也允许运维显式指定经核对的 `--paired-code REF`，工具只验证它是可解析的 Git commit，不代替部署版本核对。无迁移标记的 A 之前结构/JSON 不是本工具格式，应先按历史迁移方案在副本验证。

## 隔离恢复与配套代码

```powershell
node --experimental-strip-types scripts/data-maintenance.ts restore --snapshot 'D:\snapshots\snapshot-001' --target 'D:\isolated\restored-001'
```

恢复先验证整个快照，再在新的 `.restore-incomplete-*` 目录复制并重复检查数据库和每个文件，最后原子改名到新的目标。现有目标一律拒绝，包括重复对同一目标恢复；可重复恢复到另一个新目录。restore 不启动服务、不迁移、不覆盖现有数据，并写 restore-receipt.json。所有恢复点均是**整套快照恢复**，会包含当时的账号与密码哈希、审计及附件状态；快照之后的新写入、密码变更或审计记录不自动保留。审计不能自动撤销一次误删。

先按 manifest.codeVersion 在独立代码目录检出匹配提交（保留 Node/pnpm/package lock 配套，冻结依赖安装），再显式指定恢复目录 DATA_DIR、随机/独立本机端口启动。不要在运行中的代码目录切换 Git 或覆盖源目录。B 快照配 B 代码；A 快照配 A 代码可作为迁移前回退点，也可在另一个隔离副本上用 B 启动验证升级。只恢复代码或只复制主 DB 都不构成有效回退。验证登录、项目/任务/依赖和附件下载字节后才能另行申请切换；本轮没有做生产切换。restore 的校验不是实际业务验收的替代品。

恢复以后先保留原快照，在隔离目录启动时重试已登记任务；停止隔离服务后再 reconcile/retry/reconcile。不要先扫描在线 uploads 做“未引用即删除”。本轮重试会把已删除字节移到隔离区，正常登记附件始终受保护；若 referenced 任务异常冲突，保留待办并报告，人工排查。

## 对账、重试、隔离撤销与审计查询

`reconcile` 输出 normal（带摘要且一致）、legacy（老记录无摘要但大小一致）、missing、corrupt、orphan、pending。pending 意图优先，不当作 orphan。遗留无意图的 .part 只报告；离线且明确指定名称才能隔离。`retry` 仅处理持久化 file_jobs，失败退出码 2；重跑/重启幂等。`reconcile` 本身只报告，命令成功不表示报告无异常，必须检查分类数组。任何 referenced 附件不会因 file_jobs 冲突被删除。

```powershell
node --experimental-strip-types scripts/data-maintenance.ts quarantine --data 'D:\isolated\source' --file 'unknown.part' --offline-confirmed yes
node --experimental-strip-types scripts/data-maintenance.ts export-quarantine --data 'D:\isolated\source' --entry 'orphans/UUID_FROM_OUTPUT' --target 'D:\isolated\exported-001' --offline-confirmed yes
node --experimental-strip-types scripts/data-maintenance.ts export-quarantine --data 'D:\isolated\source' --entry 'jobs/ATTACHMENT_ID' --target 'D:\isolated\exported-002' --offline-confirmed yes
node --experimental-strip-types scripts/data-maintenance.ts audit --data 'D:\isolated\source' --resource projects --resource-id PROJECT_ID --limit 100 --offline-confirmed yes
```

隔离回执记录原文件名或附件 ID。撤销隔离用 export-quarantine 将字节复制到新的外部目录，原隔离副本保留；核对回执/字节后通过正常登录上传重新登记（新 ID、新审计），或选择整套快照恢复原资源关系。工具不猜测归属、不覆盖正常文件，也不直接复活已删除业务行。隔离目标冲突时保留源、增加重试次数，不强行覆盖。孤立文件隔离后中断：源或 UUID 隔离区至少留一份，receipt 先于 rename，按回执排查即可。没有默认永久清空命令。

审计仅通过有操作系统目录权限的离线命令查询（按资源/ID，最多 1000 条），没有公开 HTTP 审计接口。审计不是防篡改账本。客户端错误含服务器生成的 X-Request-Id/requestId，前端显示该编号并保留草稿；服务端 JSON 诊断关联同编号，记录方法、受限错误码和调用帧，刻意不记录原始 error.message/SQL、URL、请求体、Cookie、会话或密码。多行错误文本先整体移除，避免伪造调用帧。磁盘/SQL/未知程序错误为通用 500，已分类输入/权限/不存在/冲突延续 A 的 4xx 契约。附件头已发送后故障只能断开响应并留日志，不能另发 JSON。

## 策略配置与限制

2026-10-25 用户已确认策略，默认读取纳入 Git 的 config/backup-policy.json；不是待定项：

```json
{"format":1,"rpoMinutes":1440,"rtoMinutes":480,"maxDowntimeMinutes":5,"retentionDays":30,"timezone":"Asia/Shanghai","windows":["00:30","12:30"],"rtoClock":"elapsed-24x7"}
```

RPO 24h；RTO 全天 8h（实际经过时间，包含发现、响应、准备代码/机器、恢复、核验及恢复使用）；每次计划停服总额 5min；每天北京时间 00:30、12:30 两窗口；完整快照至少保留 30 天。12h 间隔给失败告警/补跑留余量，不保证连续漏跑仍满足 RPO。没有接入第三方平台、外部通知或生产定时任务。旧 backup 的 --policy 仍兼容四个目标字段；日常受管备份推荐使用以下入口，以记录运行状态与受管清单。

```powershell
node --experimental-strip-types scripts/backup-policy.ts schedule
node --experimental-strip-types scripts/backup-policy.ts run --data 'D:\isolated\source' --root 'D:\snapshots\managed' --offline-confirmed yes --manual yes
node --experimental-strip-types scripts/backup-policy.ts status --root 'D:\snapshots\managed'
node --experimental-strip-types scripts/backup-policy.ts retention --data 'D:\isolated\source' --root 'D:\snapshots\managed'
# Review the preview first; only expired managed snapshots qualify for this explicit permanent deletion:
node --experimental-strip-types scripts/backup-policy.ts retention --data 'D:\isolated\source' --root 'D:\snapshots\managed' --apply yes --delete-expired-confirmed yes
```

受管根必须在数据目录外，只初始化空目录，不能自动接管旧备份杂目录；catalog 绑定源目录，防止混用。状态失败持久化到 state.json，不推进 lastSuccessAt，status 对失败/中断/损坏/错过窗口/超过 RPO 返回非零（健康判定 exit=2），调用方必须接入持久日志和实际告警通道。当前没有短信/邮件送达或值守证明。备份阶段预算 4min，预留 1min 给外部停服/重启/健康检查；代码在阶段边界拒绝超时成功，无法强制中断单次阻塞 I/O，不能由此宣称生产总停服必定小于 5min。清理默认预览，仅显式确认后删除超过 30×24h 的登记且校验完好快照；恰好 30 天、最新恢复点、未知文件均保留；缺少新鲜恢复点/最近失败/清单损坏则拒绝执行。中断清理的残留必须人工排查。附件隔离区仍不默认永久清空。

完整调度接入、finally 恢复服务和告警责任见 [备份任务接入契约](../ops/backup-job-contract.md)，提供未启用的 timer 示例。激活生产前仍需核对实际服务单元、路径、磁盘/独立副本、值守责任人及通知通道，并在目标 OS 和真实规模副本验证。**本轮只交付并验证本地策略，没有安装/启用任何定时任务，也没有执行生产停服。** RTO 应包含完整处置流程，不能用小夹具复制耗时替代。

快照摘要用于发现损坏和缺失，不是签名或加密；需限制目录权限并保护清单与数据。当前按本机进程崩溃验证，不承诺操作系统/电源/硬件故障的落盘保障或远端共享盘安全。所有文件逐个摘要校验可能延长停服；大数据规模、磁盘耗尽、备份调度/保留执行、正式数据迁移和生产恢复尚须上线前验收。旧 SQLite 以前的 store.json/历史导入归档不进入规范快照，当前 SQLite 才是业务权威数据。

独立重演：`node --experimental-strip-types scripts/recovery-drill.ts`（先提交运行代码）。只创建系统临时目录与隔离账号，调用实际 CLI、误删项目、恢复新目录，再实际登录、请求项目页面/任务依赖、下载比较摘要，finally 只结束本次服务并检查端口关闭；报告在临时目录，不含凭据。真实 SIGKILL 的六个边界由 `pnpm check` 内 tests/batch-b-recovery.test.ts 执行，测试 IPC hook 只在独立 worker，不在应用路由。小型演练结果不等于生产恢复验证。
