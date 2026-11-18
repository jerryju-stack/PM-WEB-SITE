# Batch E-B：有界文件处理与异步一致性验证

初次记录：2026-11-03；当前分支复核：2026-11-16（Asia/Shanghai）。仅本地开发；未推送、部署或连接生产服务器。下方初次验收数据保留，最新提交及复核见文末。

## 交付与追溯

当前分支已包含 E-A 的真实代码提交 `e37b032`（E0）和 `e271284`（E1），并非仅有计划文档。在该代码上实施 E2/R3，未重置到审查基线 `fb378ef` 或文档提交 `d2bcc30`。本批实现、测试与本文由同一个 E2 提交交付，可用 `git log --oneline -- docs/batch-e-b-validation.md` 定位。

E2 的生产 HTTP Excel 公式/压缩、工作簿解析、XML 解析/生成、预览匹配/排期/比较、确认排期及 PDF 排版已移入复用的有界 worker 池。SQLite、会话、权限、租约与最终事务仍在主线程。原同步 `timingIO` 门面供离线工具/旧测试使用，HTTP 不回退到同步文件处理。未实施静态转译缓存、E3 查询优化、E4 前端优化、E5 或财务。

E-A 的浏览器最终跨账号隔离、恢复后完整保存以及编辑性能验收仍未关闭；本批没有将 DOM 控制器测试称为真实浏览器通过，也未修改 D9 审查历史。见 [E-A 验证](batch-e-a-validation.md)。

## 实现与资源预算

实施前登记见 [budgets.md](validation/batch-e-b/budgets.md)，默认值及 E0 预算未在验收后调整。

| 边界 | 实际实现 |
| --- | --- |
| 活跃/排队 | 默认 2 个复用 worker、8 个等待任务；HTTP 入口最多 10 个文件请求，包含读请求体、排队、执行和响应冲刷 |
| 文件/快照 | 上传解码后 ≤8 MiB，预览 HTTP JSON ≤12 MiB；沿用 Excel 解压总量 40 MiB；序列化任务和结果各 ≤32 MiB；等待任务载荷合计 ≤64 MiB |
| 数据库预检 | 读取计划/历史/草稿/导入预览 JSON 前用 SQL 字节长度拒绝超限；最终序列化后再检查完整任务容量 |
| 时间 | 入口至响应的绝对期限默认 10000 ms；池内期限包括排队和 worker 启动；主线程延迟定时器时仍按单调时间拒绝过期结果 |
| worker 资源 | 每个 old generation 256 MiB、young generation 16 MiB、stack 4 MiB；终止后等待 exit 才补位，故障/超时不会瞬时超额创建 |
| 配置 | `FILE_WORKERS=1..4`、`FILE_QUEUE=0..16`、`FILE_TIMEOUT_MS=100..20000`，非法值启动失败；默认 2/8/10000，字节和 heap 上限不由环境放大 |
| 停止 | SIGINT/SIGTERM 停止接单，拒绝队列/运行结果，终止并等待 worker，关闭 HTTP 连接和 SQLite |

Node 24 的 [worker_threads 文档](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html) 建议复用池；`resourceLimits` 约束 V8 heap，**不是 native/ArrayBuffer 或全进程 RSS 的硬上限**。本批同时约束输入/解压/结果字节、活跃数、排队数和时限，并实测 RSS；仍需在实际部署机器上核定可用内存。未引入微服务、持久任务队列或新格式。

worker 使用独立最小环境，显式清空继承的 preload 参数，不打开 SQLite。Excel 签名密钥只随必要任务传入；worker stdout/stderr 丢弃，错误在截断前脱敏，生产指标仅发布白名单数值/类型，不记录任务、文件、密钥或错误正文。原密钥仍在数据库 meta；没有把它写入日志或证据。

## 异步状态与事务边界

文件任务开始前固定快照，序列化传输脱离调用方可变对象。`timingFileService` 每次 await 后执行同步检查；预览/确认在事务内完成序列化后再次检查账号/权限/绝对期限，无 await 插入检查与 SQL 提交之间。

| 操作 | await 后、提交/发文件前检查 |
| --- | --- |
| 导出 | 当前 session 对应稳定 UID、authEpoch、禁用/登出、`X-Timing-Actor` 和当前项目读取权限、取消/停止/期限；发响应前再次 guard。处理期间项目合法修改可返回开始时的固定快照，文件名/内容与该快照一致 |
| 导入预览 | 上述身份及 timingEdit；草稿 ID/修订、租约 token/持有人/有效期、项目版本、执行修订。变化返回冲突，不插入旧预览 |
| 确认导入 | 同上，并复查预览存在性/所属账号/项目/草稿/租约/有效期及载荷；主线程事务原子写草稿、审计和确认 receipt |
| 重复确认/采用 | 已确认 receipt 返回原结果；并发同 preview 的确认只增加一次草稿修订；采用继续使用既有 requestKey 幂等语义，不重复生成 V 版本 |

成功确认后响应丢失属于“结果未知”，不能承诺撤销已提交事务。前端保留匹配/文件/预览，提供“取消文件处理”，不自动重试；提示刷新核对共享草稿。用户重新确认相同 preview 可得到幂等 receipt。只有确认成功才清除本地预览。页面卸载的 AbortSignal 与操作取消信号合并。

错误反馈：队列满 429、超限 413、格式问题 400、过期/修订/租约变化 409、worker 故障或停止 503、期限 504；取消内部为 499，连接已断开不再写响应。429/503 带 `Retry-After: 2`。超时/取消/异常的未提交结果不会进入数据库；已提交但响应未送达依靠 receipt 核对。

Excel 三级/100 项、XML 20 级/1000 项、当前/明确历史快照选择、预览/确认两步、文件名清洗、Content-Disposition/类型、private no-store、nosniff 规则保留。

## 回归与复现证据

旧同步路径见 [D9 R3](engineering-review-d9-2026-11-03.md) 和 [E-A 基线](validation/batch-e-a/baseline.json)：同类五文件并发下心跳 P95 1120.34 ms，超出 1000 ms 预算。本批未改旧归档 probe 来维持错误断言，新增独立文件回归。

`tests/fixtures/file-gate.ts` 只在隔离测试进程 preload：先让真实 worker 完成运算，再扣住结果交付，改变权限/草稿等状态后释放，验证最后一道检查，而非仅在请求开始前撤权。产品配置不能指定该 worker/gate。

有意义的覆盖包括：预览和确认期间撤权/降级、管理员重置密码/本人改密、登出、禁用、租约过期/换人、草稿改修订/替换、项目版本/执行修订变化、预览到期；导出撤权与固定快照；排队/执行取消、超时、worker crash/无效消息、延迟主线程定时器、停止、慢请求体占用、队列/字节/格式上限、密钥脱敏；提交前过期拒绝、审计 SQL 故障事务回滚；确认 receipt 幂等重试、并发相同确认、采用不重复。完整检查同时重跑已有 E-A“采用成功但响应丢失”的读取恢复回归；未把它混称为新的文件确认断连实测。对草稿 payload/revision、预览/receipt 逐项比较，证明失败没有部分更新。

Windows 的 shutdown 集成测试通过 IPC 在被测服务中 `process.emit('SIGTERM')` 调用实际停止处理器，验证 worker 退出和不写入；没有将 Windows 强制结束进程当作优雅停止通过。池测试另外直接验证 close 的队列拒绝和线程回收。

| 命令 | 结果与证据 |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0；[typecheck.log](validation/batch-e-b/typecheck.log)（成功无输出） |
| `node --experimental-strip-types --test tests/file-pool.test.ts tests/file-service.test.ts tests/timing-transfer.test.ts` | 12/12；[pool-ui-regression.log](validation/batch-e-b/pool-ui-regression.log) |
| `node --experimental-strip-types --test tests/file-http.test.ts` | 当时 40/40；[http-regression.log](validation/batch-e-b/http-regression.log)。随后新增超限回归，最终完整入口包含该文件全部 41 项 |
| `node --experimental-strip-types --test tests/file-formats.test.ts` | 1/1；真实 worker XML 20/1000 往返、XML1001/Excel101/Excel深层拒绝；[formats.log](validation/batch-e-b/formats.log) |
| `node --experimental-strip-types scripts/check.ts` | 类型检查 + **171/171** 全部测试 + Git 空白检查，exit 0；[check.log](validation/batch-e-b/check.log) |
| `node --experimental-strip-types scripts/benchmark-e-b.ts` | exit 0；[benchmark.log](validation/batch-e-b/benchmark.log)、[performance.json](validation/batch-e-b/performance.json) |

调试时修正了取消测试缺少完整预览对象的夹具。完整检查另曾遇到旧 HTTP 测试随机分配到 Fetch 禁用端口；公共测试夹具改为探测 20000–60000 的空闲端口，生产端口不变。最终记录为上表通过的运行，未保留过时失败日志作为验收证据。端口探测至服务绑定间仍可能被外部进程抢占，遇到时重新执行隔离测试。

## 最终容量测量

环境：Node **v24.22.1**，Windows 10.0.26200，AMD Ryzen 7 9700X，16 逻辑核，RAM 50,634,108,928 bytes。隔离目录、UTC 时间、源码 SHA-256、逐请求和逐轮指标均在 JSON 中。JSON 的 commit 字段记录测量前 HEAD `e271284`；实际被测未提交代码由 `sourceSha256` 固定，可与本批提交中的 8 个对应文件比对，不能误称测量的是原 E-A 代码。

复用 E-A `syntheticTasks`：100/500/1000 项、20 层、链式/扇出/长工期。文件组合与 E-A 一致：2 Excel100 浅层、2 XML1000/20层链式、1 PDF100 长工期浅层。每轮 5 请求同时发出；每 25 ms 持续请求普通 `/api/data` 和编辑 heartbeat，并等待所有探针收尾。一次冷 worker 启动轮（不是 OS 缓存冷启动），随后 30 个热轮，共 150 个热文件样本；P95 用排序后 `ceil(0.95*n)`，同时记录最大值。普通接口和心跳分别 862 个热样本，零错误，最后再次心跳成功。

| 指标 | P95 ms | 最大 ms | 判定 |
| --- | ---: | ---: | --- |
| 热轮全部五文件完成（30轮） | 885.74 | 900.02 | 记录，不另设新预算 |
| 热心跳（862） | **9.15** | 24.53 | <1000 ms；30 秒租约未失效 |
| 热普通接口（862） | **4.30** | 6.71 | <500 ms；仅文件并发场景 |
| 热池排队（150） | 115.52 | 120.87 | 包括池调度等待 |
| 热 worker 执行（150） | 769.98 | 800.36 | 不含排队，含传输/调度 |
| 热 worker 内部计算（150） | 769.50 | 799.66 | 不含 worker 启动和结果传输 |

冷轮总 872.48 ms；心跳 P95/max 8.92/9.88 ms，普通接口 3.96/7.76 ms。首次 XML worker 执行 143.84 ms、内部计算 11.92 ms；首次 Excel 执行 722.94 ms、计算 591.03 ms，差额包含 worker 启动。冷轮排队最大 266.13 ms。

峰值 worker **2**、等待队列 **3**。50 ms 采样 RSS 峰值 548,581,376 bytes；`resourceUsage.maxRSS` 549,646,336 bytes（约 524 MiB）；主线程 heap 66,825,664 bytes；worker 运算后 heap 样本最大 125,678,016 bytes（不是 worker heap 全程峰值）。事件循环采样最大 36.73 ms；25 ms 探针最大漂移 108.54 ms。详见原始 JSON，未将采样峰值当作严格内存上界。

另做一轮深层 PDF +4 文件压力：20 层/100 项长工期 PDF 233.98 ms，5 文件均 200，轮次 672.00 ms；心跳 P95/max 7.79/9.40 ms、普通接口 4.13/5.22 ms，项目版本/执行修订均未改变。这只证明生成/服务可用，**不代表深层 PDF 视觉布局或 Project 桌面互操作通过**，R7/E5 保留。

本次不装载 E-A 的 100/1000 个完整历史快照、不并发重历史列表查询，所以不能将约 524 MiB 与 E-A 的约 3 GiB 当作同负载内存优化比，也不能将普通接口 4.30 ms 当作 E3 全容量验收。E-A 历史列表 P95 578.36 ms 和浏览器编辑超预算仍保持原记录。

## 隔离、清理与后续复用

所有 HTTP/服务/格式回归及基准使用系统临时目录独立 SQLite 和附件目录。未读写生产数据。`scripts/check.ts` 会重生成受跟踪的 D2/D3 XLSX/PDF 示例；本次先将确由 `tests/timing-io.test.ts` 重生成的两个文件复制到忽略的 `.deploy/batch-e-b-generated-samples/` 并核对 SHA-256，再只恢复这两个与交付无关的样例。原有 `.gitignore`、`docs/batch-b-validation.md` 改动和未跟踪 `AGENTS.md` 保留，不纳入本批提交。

E-C 可复用：

1. 保持本批默认 FILE_* 配置，运行 `scripts/benchmark-e-b.ts <独立输出路径>` 复测普通接口/心跳，保留 source hashes。每次自动创建新的数据目录，不传生产 DATA_DIR。
2. 复用 `scripts/e-a-fixtures.ts` 和 `scripts/benchmark-e-a.ts` 的历史规模/查询计数/字节测量，处理 E3 元数据分页、snapshot 读取放大和首页数据量；不要用本批轻历史文件场景代替历史容量负载。
3. 对任何新增 await，复用 `timingFileService` 的“固定快照→隔离计算→同步最终检查/事务”，并扩展 computed-result gate 回归。不要让 worker 访问 SQLite 或加入 HTTP 同步兜底。
4. 最终运行完整入口，留意示例重生成，只恢复有备份且确定由本次测试生成的文件。

E2 已有代码、完整回归和本机容量证据，具备进入 **E-C（E3）本地开发**的条件。仍需在发布前完成实际部署环境内存/并发测量、E-A 浏览器关闭项、E3/E4 容量及 E5 集成验收；没有据此宣称可进入财务或部署。

## 2026-11-16：当前分支复核及写入边界加固

本轮开始 HEAD 为 `4468730`，E-A 的 `e37b032`/`e271284`、E-B 的 `ac2b273` 均为当前分支祖先；也已存在 E-C 的 `e1eccc3`/`4468730`。这些是实际代码提交，没有回退到旧审查版本。本轮范围仍只补齐 E2，没有继续 E3–E5 或财务实现。开始时已有的 `lib/timing-pdf.ts`、E5 脚本/测试/证据以及用户 `.gitignore`、`docs/batch-b-validation.md`、未跟踪 `AGENTS.md` 均保留，不纳入本轮提交。

新增代码提交 **`47603a2`**：

- 预览落库前在 payload 序列化后再次检查租约；草稿写入在同步计算/序列化后再次检查租约、草稿 ID 与修订；确认导入在写入前再次检查预览到期时间。即使没有 await，时间也可能在计算期间跨过到期点。检查仍紧邻主线程事务，worker 不访问 SQLite。
- 确认响应断开或 JSON 截断时，前端明确提示“结果尚未确定，请刷新核对共享草稿”，保留文件、匹配和预览，不自动重试。收到明确 409 等业务拒绝时继续显示服务器原因，避免混称结果未知。
- 新增真实 HTTP 测试：确认已提交后代理丢弃响应；重读可见草稿修订、执行计划未被采用，同一 preview 重试返回原 receipt，不再次增加修订；之后采用及重试只有一个 V 版本。另有提交边界租约/预览到期、前端响应截断/网络错误/明确冲突回归。
- 基准现在核对 30 热轮、150 热文件及每轮心跳/普通接口样本、零探针错误、深层压力请求成功及项目修订未变；测量前后检查源文件哈希一致。新增公式/XML/PDF/排期、模板、字体、锁文件等依赖哈希，不再只记录 8 个入口文件。

当前工作区完整入口通过 **185/185**，其中包含开始时已有的未提交 E5 测试；因此不能用该数量声明本次提交包含 E5。见 [当前工作区完整检查](validation/batch-e-b/current-check.log)。最终 E2 相关回归 **61/61**、类型检查退出 0，见 [相关回归](validation/batch-e-b/current-regression.log)、[类型检查](validation/batch-e-b/current-typecheck.log)。首次沙箱运行的 HTTP 连接被 `EACCES 127.0.0.1` 拒绝，获准使用本机回环后重跑通过，没有修改产品权限或把环境限制记为产品失败。

为排除未提交 PDF/E5 对结果的影响，另从最终代码 **`5576578`** 创建本机临时 clone，复用当前锁定的 node_modules（junction），运行相同完整检查及基准；原工作区及用户改动不参与该副本。`47603a2` 的副本已通过 184 项完整检查，但基准指纹误用了本机才有的 `package-lock.json` 而启动失败；`5576578` 改为仓库跟踪的 `pnpm-lock.yaml` 后重新执行。仅该副本重生成其自身样例文件。最终复核元数据见 [committed-validation.json](validation/batch-e-b/committed-validation.json)，日志见 [committed-check.log](validation/batch-e-b/committed-check.log)、[committed-benchmark.log](validation/batch-e-b/committed-benchmark.log)。这不是另一个生产实例或部署。工作区中间测量已移至忽略的 `.deploy/e-b-preliminary-*`，最终性能结论只引用提交副本。

**最终代码副本完整入口：184/184，类型检查与 Git 空白检查均通过，退出 0。** 副本基准也退出 0；[逐轮数据与全部哈希](validation/batch-e-b/committed-performance.json) 的 commit 为 `5576578ea91e9c991cfadb251d893ea9a8f99e27`，没有依赖未提交 PDF 修复。使用相同 Windows/Node 24.22.1/Ryzen 9700X/16 逻辑核/50,634,108,928 bytes RAM 环境、相同 E-A 样本、默认 2/8/10000 配置及原预算。冷启动是新 worker 的首次启动，不声称 OS 文件缓存为空。

| 最终热运行指标 | 有效样本 | P95 ms | 最大 ms | 判定 |
| --- | ---: | ---: | ---: | --- |
| 每轮五文件全部完成 | 30 | 889.60 | 902.10 | 记录，无另设批次完成预算 |
| 编辑心跳 | 891 | **6.96** | 14.87 | <1000 ms；最后心跳成功，30 秒租约未失效 |
| 普通 `/api/data` | 891 | **1.57** | 2.82 | <500 ms；仅文件并发负载 |
| worker 排队 | 150 | 106.97 | 110.97 | 记录 |
| worker 执行（含传输/调度） | 150 | 780.69 | 823.79 | 记录 |
| worker 内部计算 | 150 | 780.23 | 820.10 | 记录 |

冷轮 1013.28 ms，5 文件均成功；心跳 39 个样本 P95/max 6.78/7.27 ms，普通接口 2.44/7.39 ms。首次 XML 执行/计算 200.60/9.42 ms、首次 Excel 855.40/662.53 ms，冷轮排队最大 336.12 ms。热轮 150 个文件、全部探针及额外深层压力均无错误。

峰值 worker **2**、等待队列 **3**；50 ms 采样 RSS 峰值 **538,497,024 bytes**，进程 maxRSS **539,832,320 bytes（514.82 MiB）**；主线程 heap 最大采样 60,965,408 bytes，worker 运算后 heap 最大采样 116,930,808 bytes。事件循环采样最大 35.95 ms、25 ms 探针最大漂移 188.48 ms。采样值仍不是 native/ArrayBuffer 或全进程 RSS 的硬上限。

额外深层 PDF +4 文件压力：5 个响应均 200，轮次 687.41 ms，深层 PDF 245.48 ms；心跳 P95/max 6.58/8.21 ms，普通接口 1.35/2.06 ms，项目版本/执行修订未变。该结果证明本轮文件任务有界及服务响应正常，**没有验收 PDF 视觉布局、Project 桌面互操作，也没有验收重历史负载或浏览器 1000 项编辑预算**。

复用命令（在仓库根目录执行；每次新建隔离数据）：

```text
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test tests/file-pool.test.ts tests/file-service.test.ts tests/file-formats.test.ts tests/file-http.test.ts tests/timing-transfer.test.ts
node --experimental-strip-types scripts/check.ts
node --experimental-strip-types scripts/benchmark-e-b.ts <新的独立输出文件.json>
```

本轮运行完整检查前，两个受跟踪样例均无 Git 改动。先备份运行前内容，再将确由测试生成的现值复制至 `.deploy/batch-e-b-current-samples/`、核对 SHA-256，最后恢复运行前副本：XLSX `71b0a907ac0daacc051e4ff0431488737864c95d417f7c5030cb0ab13bd1cb3e`；PDF `0f8edb8114deca715044812d83068da22553faf17da84849ad00466e87f77d6f`。生成副本及前后 manifest 均留在忽略目录；没有恢复或清除其他未提交内容。实际 D9 审查文档未改动。

**本轮结论：E2 本地实现与提交代码验收完成，具备继续 E-C 本地工作的文件基础。** E-C 可直接使用上列基准新输出路径、固定快照/同步最终检查及 computed-result gate。仍沿用 E-A 未关闭的浏览器项、E3/E4 容量与 E5 验收遗留；本轮没有将它们关闭。部署前须在目标机器核定内存及 worker 配置；不据本机 515 MiB 样本承诺生产容量，不推送或部署。
