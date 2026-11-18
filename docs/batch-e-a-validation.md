# Batch E-A：E0 基线与 E1 保存/恢复修复验证

日期：2026-11-03（Asia/Shanghai）。仅本地开发，无推送、部署、SSH 或生产数据操作；未开始财务、E2–E5 实现。

## 结论与追溯

- **E0：隔离基线、容量预算和可复用脚本已建立；预算有未达标项，保留原值。**
- **E1/R1/R2：修复及可执行回归完成；真实 Chrome 核心恢复、Escape、双页面路径已执行，但最终浏览器验收仍有遗留，未完整关闭。**
- 本次工作起点实际为 `f10f03af117b1b70a7d34ba69e1485eb645e44a0`；审查基线 `fb378ef`、审查文档 `d2bcc30` 仅追溯，没有 reset/checkout 到旧代码。E0 首次提交为 `e37b032`。修复提交以 Git 中 `fix: preserve Timing inputs across failed saves and lease recovery` 为准；本文件与修复一同提交，避免自引用提交号。
- D9 报告及其 `probe.mjs` 保留历史。优化前再次执行 probe，得到失败退出仍 release/reload、重入清空 pending、Escape 拒绝后仍清 selection 的复现；见 [复现结果](validation/batch-e-a/reproduction-before.json)。修复后使用独立测试，未修改归档 probe 来维持旧缺陷。

## E0 环境、方法与结果

环境：Windows 10.0.26200，Node v24.22.1，AMD Ryzen 7 9700X，16 逻辑 CPU，RAM 50,634,108,928 bytes；本机 SQLite / 回环 HTTP。完整原始环境及临时目录记录在 [baseline.json](validation/batch-e-a/baseline.json)。

预登记 [budgets.md](validation/batch-e-a/budgets.md) 在业务修复前写入并提交。**没有调整预算**：5 并发文件请求时心跳 P95 < 1000 ms、无 30 秒租约失效；历史列表/首页 P95 < 500 ms；1000 项编辑到可交互 P95 < 500 ms。

数据：100/500/1000 项 × 链式/扇出/2600 工作日长工期，19 级汇总加第 20 级叶任务；从 2000-01-03 排期，逐项经 `schedule` 与 `dateValue` 验证，日期不越过 2100，工期不越过 2600。链式使用 1 工作日，长工期不叠加链式。100/1000 历史 × 100/1000 项交叉测量。Excel 使用独立浅层 100 项，XML 使用 20 层/1000 项，PDF 使用浅层长工期/长名称 100 项，遵守各格式限制，不把深层 PDF 的 R7 纳入 E-A 修复。

每操作单独记录首次调用和 30 热样本；首次调用不是 OS 页缓存冷启动。P95 用 nearest-rank，另记最大值。排期/SQL 是进程内路径，HTTP 为真实回环 RTT。五并发组合为 2 Excel + 2 XML + 1 PDF；心跳每 25 ms 探测以得到足量竞争样本（生产仍为 8 秒心跳），不宣称该探测频率是生产流量。

| 路径 | 优化前首次 ms | 优化前热 P95 / 最大 ms | E1 中途对照热 P95 / 最大 ms | 预算状态 |
| --- | ---: | ---: | ---: | --- |
| 首页，11 合成项目/0 文章 | 3.99 | 6.19 / 7.23 | 5.76 / 5.97 | 此轻样本通过；不代表文章正文规模通过 |
| 历史 HTTP，100 项×1000 版 | 68.77 | 63.52 / 68.61 | 61.70 / 61.83 | 通过 |
| 历史 HTTP，1000 项×1000 版 | 466.20 | 578.36 / 626.51 | 570.01 / 627.15 | 未达 <500 |
| 五文件并发中的心跳 | 包含在首批 1308.50 ms | 1120.34 / 1330.66 | 1005.57 / 1117.86 | 未达 <1000；两次租约均存活 |
| Chrome 1000 项输入至双 animation frame | 81.60 | 4826.00 / 5890.50 | 待采集 | 未达 <500 |
| Chrome 输入至保存、重读及双 frame（含 800 ms debounce） | 3618.50 | 4990.40 / 5993.40 | 待采集 | 单独诊断路径，不将 debounce 偷换成编辑预算 |

原始进程内排期 P95（100/500/1000 项）：链式 1.43/7.19/25.36 ms；扇出 1.16/7.32/20.61 ms；长工期 13.56/73.17/138.48 ms。完整首次/最大值见 JSON。

1000 项×1000 历史，单次列表 **1002 个查询、读取 350,716,000 bytes snapshot**；100 项×100 历史也有 102 查询。没有在 E-A 优化此读放大，留给 E3。原始合成数据可重复生成，不提交大 SQLite 文件。

内存：优化前 harness 采样峰值 RSS 2,834,608,128 bytes、OS maxRSS 3,352,420,352；服务子进程 50 ms 采样峰值 RSS 3,181,809,664、heap 2,493,925,216 bytes。对照服务 RSS 3,280,867,328、heap 2,582,641,600；Chrome 原始末次 heap 25,116,207 bytes（不是浏览器峰值）。各操作的 `processPeakRssBytes` 是 harness 累积高水位，不能归因于该单步操作。50 ms 子进程采样可能遗漏同步尖峰。

事件循环 histogram 原始最大值为 1212.15 ms，对照 74.51 ms；监控回调/重置时序及同步阻塞会影响该采样，**不能据此宣称 E2 已优化**，应结合真实心跳 RTT。对照时间为本日 01:38，发生在 E1 部分修改后、最终交互修正前；它是相同文件/SQL路径的辅助对照，不是最终浏览器验收。E-A 没有修改文件任务或历史 SQL，这些差异不作为性能优化收益。

Chrome [原始基准](validation/batch-e-a/browser-baseline.json)：只读加载 `e37b032:src/timing.ts`，没有重置工作区。基准按钮在真实页面触发输入事件并等待保存/重读和 frame，31 次 = 首次 + 30 热；不是 DOM 桩，也不把程序触发事件冒充物理键盘回归。物理 Escape 另有 [浏览器证据](validation/batch-e-a/browser-evidence.md)。1000 项自动化观测出现超时，页面内计时用于减少反复 CDP 轮询干扰；可见标签页原始结果仍超预算，留给 E4。

## E1 实际修复

1. `flushInputs()` 为 false 时，退出/历史目标切换/抽屉关闭/任务切换/站内路由链接均停止。`EditTransition` 串行化离开检查，Escape 正确 await；未决重复键不会提交第二次关闭。
2. 行内值保留原始字符串，空工期/完成度不再静默变成 0。保存失败不自动打开抽屉、不改变原 selection。校验失败先阻止批量写入。
3. 本地输入单独持久到当前标签页 `sessionStorage`，并有内存降级。键使用服务端 `safeAccount.id`（稳定 UID）和 projectId，不使用可复用登录名；不保存租约 token/请求。成功写入才移除对应本地输入；明确放弃才清除未提交副本。存储被禁用时仅内存可用，关闭标签页不保证保留。
4. 丢失租约保留输入且停止写入。重新进入先检查当前身份、获取新租约、读取最新共享草稿，再显示字段比较；用户选择恢复只填回本地输入，手动保存仍经最新 revision/新 token。缺失原任务时禁止恢复成替代记录。取消或读取失败保留副本，不能自动重放旧 PATCH/采用请求。
5. `X-Timing-Actor` 在请求体读取后与当前稳定 UID 校验，覆盖其他标签页换 Cookie 的边界；`/api/session` 供重新进入检查。发现身份变化时隐藏旧账号输入，旧副本仍按原 UID 隔离。原有租约 token+actor 双重校验及授权保留。
6. 未决输入使用 readonly 保留焦点/光标；失租的脏输入也可选中复制但不能继续修改。抽屉提供可达的“重新进入编辑并比较”入口，避免被 backdrop 挡住。
7. 写入已确认、但重新读取失败，有独立状态并阻止无意重提；采用已确认时重读失败不再报告采用失败。采用响应丢失则提示重新读取核对，不自动采用；服务端回执仍防重复版本。
8. 恢复/刷新后的抽屉 `requireSave()` 保持未确认状态，重复采集相同本地值不能误标为已保存。新确认对象不继承此标记。

本地输入、服务器共享草稿、正式执行计划和租约是四个独立对象；界面保存状态及比较说明明确区分。自动保存只写共享草稿，正式采用语义未改变。

## 命令与结果

所有测试数据使用 `mkdtemp` 独立目录；未设置正式 `DATA_DIR`。首轮沙箱 HTTP `EACCES 127.0.0.1` 后允许本机回环重跑，未记为产品失败。

```text
node --experimental-strip-types docs/validation/d9-engineering-review/probe.mjs
node --experimental-strip-types scripts/benchmark-e-a.ts docs/validation/batch-e-a/baseline.json
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test tests/timing-edit.test.ts
node --experimental-strip-types --test tests/timing-recovery-http.test.ts
node --experimental-strip-types scripts/check.ts
node --experimental-strip-types scripts/benchmark-e-a.ts docs/validation/batch-e-a/after.json
```

- 初始完整检查 **91/91**：[check-baseline.log](validation/batch-e-a/check-baseline.log)。
- 最终类型检查退出 0：[typecheck.log](validation/batch-e-a/typecheck.log)。
- 新控制器回归 **25/25**，真实 HTTP 新回归 **2/2**；完整检查 **118/118**、类型检查和 Git 空白检查通过：[regression.log](validation/batch-e-a/regression.log)、[http-regression.log](validation/batch-e-a/http-regression.log)、[check-after.log](validation/batch-e-a/check-after.log)。
- 覆盖行内/抽屉的断网、400/401/403/409，空值校验，失租/重入/占用，恢复/放弃/取消，路由/历史/Escape，取得新租约后最新读取失败，已确认写入与重读失败的区别。真实 HTTP 用代理等待采用提交成功后销毁响应，再读执行计划确认，并验证回执重试不重复版本。原有撤权、中途账号/权限变更及旧租约后端回归仍通过。
- 控制器测试使用当前完整挂载控制流及 I/O 桩，不声称是浏览器；真实浏览器执行结果和未执行项分开列在 [browser-evidence.md](validation/batch-e-a/browser-evidence.md)。
- 测试确实重新生成了仓库 Excel/PDF 样例；初始 Git 中两者均干净。`tests/timing-io.test.ts:53` 明确重写两者，最后修改时间 08:29:03，与完整检查结束 08:29:07 对应。首次恢复申请因自动审批认为归属证据不足被拒；核对后先复制全部生成现值至忽略目录 `.deploy/batch-e-a-generated-samples`，验证原文件/副本 SHA256 一致（PDF `4BEB7854700817B83AAA082A0886B862089F87055D2550345976244F3D0A96EA`；Excel `0E46AC5FE0D6B44FCAA66AFE64C24B78DB41760C5FF9FCA7D7693F6EA10FB594`），再获准只恢复这两个样例，没有丢弃未保留的内容。用户原有 `.gitignore`、`docs/batch-b-validation.md`、未跟踪 `AGENTS.md` 保留且不暂存。
- 本机端口 10360、6931、11236 最终检查无监听；浏览器临时服务未作为常驻服务留下。未将临时数据库、未采用的启动日志或测试账号凭据作为业务数据提交。

## 遗留与进入 E-B

E1 尚未完整关闭：最终跨账号登录浏览器隔离、最终“刷新→比较恢复→显式保存→重新读取”、历史/路由/撤权浏览器矩阵，以及修复后 30 热样本浏览器性能对照待补。原因和已执行证据见浏览器记录。最后跨账号操作曾被自动审批审查因用量限制阻止；继续时本地浏览器又被 Work 设置禁用，没有绕过或伪记通过。

**目前不满足“E1 全部验收关闭后进入 E-B”的严格条件。** E2/E3 已有固定数据、预算及原始基线可供后续实施，但开始 E-B 前应先补齐上述关闭项；更不能据此进入 F 财务或部署。E2 文件任务、E3 查询、E4 计算/渲染、E5 PDF/恢复/桌面互操作均仍待实施。

## 后续复用

1. `scripts/e-a-fixtures.ts` 导出确定性合成任务；基准每次新建临时库，不接受生产数据目录。
2. 用上述 benchmark 命令输出新文件，保留本次原始 JSON；不得覆盖或事后修改 `budgets.md` 来使验收通过。需要新预算先登记理由再测量。
3. `node --experimental-strip-types scripts/e-a-browser.ts` 启动本机真实服务器+故障代理，输出地址，元数据放在忽略的 `.deploy/e-a-browser.json`。`--baseline` 从 `e37b032` 只读加载原编辑器；`--reuse` 只复用已生成的隔离目录。终端 Ctrl+C 停止；Windows 强制结束若有遗留锁，使用现有 `scripts/data-maintenance.ts unlock --data <该隔离目录>` 检查死进程后解锁，不直接删锁。
4. 浏览器打开输出地址 `/projects/browser-30/timing` 或 `/projects/browser-1000/timing`；仅使用脚本内显式的合成测试账号。进入编辑后点击“运行30次隔离浏览器基准”，读取 `#app[data-ea-timings]`；保存状态完成后再读取统计。
5. `node --experimental-strip-types scripts/e-a-control.ts tasks drop|400|409|delay|commit-drop`，以及 `read 503`、`adopt commit-drop`、`heartbeat 409`、`expire`、`clear` 可注入故障。控制脚本校验系统临时目录及 `station-e-a-browser-` 前缀；沙箱临时目录映射不同应在相同本机测试环境运行，不能放宽到生产目录。
6. 请求日志只记时间、方法、路径、故障种类，不含身份凭据和业务请求体。SQLite、大媒体和临时服务日志不提交。

## 2026-11-16 E 集成关闭记录

以上为E-A交付时的原始状态，未覆盖或改写当时失败/未执行证据。E5已在当前E3/E4前端上补齐真实IAB验收：断连/400/409、行内/抽屉、校验、重复/未决Escape、失败退出/历史/路由、第二页面占用、撤权、新租约后最新读取失败、显式比较恢复→手动保存→刷新重读、跨账号隔离及原UUID返回恢复、采用响应丢失后的读取和不重复采用。见 [最终浏览器逐项记录](validation/batch-e/browser-evidence.md) 与 [E汇总](batch-e-validation.md)。

浏览器验收还发现并修正重试时旧失败文字遮蔽pending、采用响应丢失被误报通用保存失败两项反馈，代码 `5740bd8`；`a4b4331`进一步保留负责人输入节点。最终完整检查190/190通过，原始D9 probe未改动。1000项最终真实IAB固定1701×1232、首次+30热样本，输入两帧P95/max65.3/65.8ms，保存916.5/923.7ms；31次原输入节点保留。旧E0控制器IAB参考3554.1/3994.2ms当时未固定视口，不精确归因；中间未受控帧异常及后续三尺寸控制均保留，详见E汇总。保存确认含800ms防抖，不与输入延迟混算。

据新增实际证据，**E1本地验收关闭**；此前阻止严格进入E-B的浏览器缺口已补齐。E0容量及整个E/F准入状态以E汇总的最终证据为准，不把本追加解释为当初已完成，亦不表示生产部署。
