# Batch E 集成验收与 F 准备

2026-11-16（Asia/Shanghai）。仅本地开发/隔离合成数据，未推送、部署、SSH、巡检或修改生产数据。审查基线 `fb378ef`、文档 `d2bcc30`、D9代码 `0b3f05f` 均只追溯，没有reset当前分支。

## 结论与代码

**E0–E5 的本地实施和核心验收完成，可以进入已确认范围的 F0 项目口径准备。** Microsoft Project 桌面程序未发现，按工程计划保留“MSPDI支持，桌面实际打开/回导待验收”的外部限制；不据内部XML往返声称桌面通过。本结论不等于生产部署，也不等于F业务已实现。

| 代码提交 | 实际内容 |
| --- | --- |
| `e37b032` | E0隔离基线、预算、可复用样本/脚本 |
| `e271284` | E1输入恢复、失败离开与异步Escape |
| `ac2b273` | E2有界worker与异步最终检查 |
| `e1eccc3` | E3元数据/摘要分页、迁移9/10、历史指纹及任务索引 |
| `4468730` | E4增量行/抽屉更新、事件委托、保存期间交互与接口类型 |
| `47603a2`、`5576578` | E2提交前时间边界、确认响应丢失反馈及基准可移植性加固 |
| `5740bd8` | E5深层PDF、采用未知状态/重试反馈、真实格式边界与D9整体恢复回归 |
| `a4b4331` | E4负责人/备注保存保留原输入节点与行；空闲帧/同步处理/longtask/逐样本视口诊断及回归 |

最初E-A/E-C文档中的失败和未验收状态保留历史，文末追加最终关闭证据；D9审查原文及probe不改。完整检查已从审查时91项增至 **190/190**，不把增加测试数量本身当验收结论。

## R1–R7 问题、修复与证据矩阵

| 问题 | 修复代码与不变量 | 实际证据 | 状态/剩余项 |
| --- | --- | --- | --- |
| R1 保存/失租/重入清输入 | E1状态转换与稳定UUID/项目隔离的本地副本；新授权/租约/最新读取后显式比较，不自动重放 | 当前控制器断网/400/401/403/409、校验、旧租约、重新读取失败、恢复/放弃测试；真实浏览器400/409/断连、第二页面新值比较→恢复→手动保存→刷新重读、撤权及跨账号/原账号返回 | 本地关闭；sessionStorage不是永久/跨设备备份 |
| R2 Escape绕过异步离开 | await统一离开门禁，未决/失败不关闭，重复Escape只提交一次转换；E5修复旧错误文字遮蔽pending | 真实抽屉400/校验失败、3秒延迟双Escape、焦点/值/只读保留，完成后仅关闭一次；对应控制器回归 | 本地关闭 |
| R3 同步文件阻塞与await竞争 | 固定快照、有界复用worker，主线程SQL/事务；await后身份/epoch/能力/草稿/版本/租约/预览与绝对期限复查，序列化后最终时间检查 | 真实worker结果hold后撤权/改密/换租约/改修订等，取消/超时/故障/停止/回滚及回执；最终代码30轮五文件+普通接口+心跳 | 本地关闭；RSS不是OS硬上限，目标部署环境仍须核定 |
| R4 历史snapshot与逐项查询放大 | 元数据SQL/删除过滤/稳定分页；指纹只缩小候选，保留最终等价判断/旧数据补索引 | 100/1000任务×100/1000历史：列表1查询/0 snapshot bytes；碰撞/元数据/删除/撤销；真实历史50→100→124、末页比较/预览/删除撤销/导出 | 本地关闭；首次迁移/缺失侧表补索引有一次性成本 |
| R5 重复扫描与全页重绘 | 单快照byId/父子/同级/WBS，整周工作日计算、语句复用；增量行/抽屉、委托与捕获守卫 | 冻结旧算法100/500/1000链式/扇出/长工期/20层/精确进度等价；真实1000行输入、末行焦点/光标/滚动保留、失败恢复未回退 | 本地关闭；不需要凭猜测引入全站框架或虚拟化 |
| R6 首页正文/权限读放大 | 独立摘要投影及分页、正文/账号按需；同步请求内权限上下文，不跨请求缓存 | 500篇×12KB正文响应6.10MB→8.3KB；SQL不读正文；授权前分页/计数/撤权；真实卡片/搜索/分类/详情/账号/归属选择 | 本地关闭；财务金额不进入公开聚合 |
| R7 深PDF、跨格式、恢复与文档 | 深缩进封顶、WBS/名称/进度与页眉测量一致、共享行高；实际D9恢复及文档同步 | 7类33页PDF渲染/Unicode/边界/条行几何；Excel/XML真实worker三快照及格式回归；D9 schema8→10旧表摘要/整体恢复/归档附件字节/会话与租约 | 网站本地验收关闭；Project桌面互操作明确待验收 |

## 真实浏览器

使用IAB真实浏览器、独立 `station-e-a-browser-*` 数据；不是DOM桩。逐项动作、值、焦点与截图见 [browser-evidence.md](validation/batch-e/browser-evidence.md)。重点证据：

- [最新共享草稿与本地输入比较](validation/batch-e/recovery-comparison.jpg)、[恢复后手动保存](validation/batch-e/recovery-saved.jpg)。第二页面占用时不清输入；新租约后读取第二页面的新值，未自动覆盖。
- [未决Escape修复后的状态](validation/batch-e/escape-pending-fixed.jpg)：值和焦点保留，抽屉未关闭，显示正在保存；成功后关闭。400、校验失败同样保留。
- [新账号隔离](validation/batch-e/other-account-isolated.jpg)、[原账号返回](validation/batch-e/original-account-recovery.jpg)、[撤权保留输入](validation/batch-e/revoked-local-preserved.jpg)。按稳定身份隔离，不只按登录名。
- [采用响应丢失准确反馈](validation/batch-e/adopt-lost-fixed.jpg)、[重读后无变化重试](validation/batch-e/adopt-retry-no-duplicate.jpg)。首次浏览器复现发现旧通用失败提示，已修复并回归；同一旧请求键幂等由真实HTTP回归另证，不混称新租约下无变化采用为同键重放。
- [写入已确认、重读失败](validation/batch-e/write-confirmed-read-failed.jpg)与未送达写入分开处理。新租约后的最新读取503则不进入恢复比较，保留输入并释放不可用租约。
- [后续历史导出选择](validation/batch-e/history-export-pages.jpg)、[正文按需详情](validation/batch-e/article-detail.jpg)、[末行保存](validation/batch-e/last-row-saved.jpg)。末行保存前后双pane scrollTop=43719，焦点/光标和值保留，见 [数值](validation/batch-e/browser-scroll.json)。

历史50→100→124；比较和预览可选最后页，后续页删除撤销后仍可加载。导出选择52→102→125保留选中历史；实际下载XML核对30项原始负责人，不受共享草稿改动影响，见 [文件核对](validation/batch-e/browser-history-download.json)。项目24→48→57、文章24→48→55、B分类28、管理员账号24→30；跨页搜索、正文及手记归属后续项目实际可用。

浏览器过程中CDP点击曾超时，随后读取实际删除/恢复状态核实结果；没有把点击超时本身当通过。原Chrome最小化/中间超预算记录保留在E-A/E-C，最终使用同一可见IAB作新旧控制器对照，不倒改原始数据。

## PDF、格式及数据恢复

PDF使用合法1/3/15/16/20层、长名称、长项目标题、空计划、里程碑、2000–2100日期和2600工作日样本。共33页，PDFPlumber独立检查全部任务/项目Unicode、字符页面边界、实际表格行线与条/里程碑中心；Poppler渲染全部页并审阅接触表及代表性首末页。见 [PDF数值](validation/batch-e/pdf-results.json)、[视觉审阅](validation/batch-e/pdf-review.md)、[接触表](validation/batch-e/pdf-contact.jpg)。不是仅断言文件存在。

`tests/e-format-boundaries.test.ts` 让历史、执行及共享草稿具有三个不同负责人；真实HTTP/worker分别导出Excel/XML的当前与指定历史，预览确认历史文件只改变共享草稿，执行修订、历史内容/列表不变。现有D3/D9/E2回归还覆盖三级/100与20级/1000、超限拒绝、不支持的格式/错误文件、签名身份/手工匹配/删除影响、无延迟FS及回执重试。没有扩展`.mpp`或Excel上限。

恢复演练直接从Git的D9实际lib/assets生成schema8合成数据，校验D9与当前依赖锁相同；含执行/依赖、共享草稿、有效租约、导入/采用回执、软删除/撤销、未采用归档、被删除任务占位及实际附件字节。备份8→新目录恢复→旧代码打开核对→升级9/10；全部旧表摘要不变（除schema_migrations），再备份10→第二新目录整体恢复。恢复后原真实cookie401，有效旧租约阻止新页面409，到期后新token可编辑，旧token/导入/采用会话409，软删除恢复及附件下载哈希一致，全部夹具端口关闭。见 [recovery.json](validation/batch-e/recovery.json)、[日志](validation/batch-e/recovery.log)。最终配套E代码为 `a4b4331`，D9拒绝schema10，不能只回退代码。

Microsoft Project App Paths（HKLM/HKCU/32位）及标准Office16路径未发现WINPROJ.EXE，未安装付费软件、未实际桌面打开/回导。见 [可用性核对](validation/batch-e/project-desktop.json)。这是保留限制，不属于网站内部XML通过证据。

## 容量、预算与测量边界

预算继承E-A预登记，不调整：五并发文件心跳P95<1000ms、无30秒租约失效；首页/历史P95<500ms；1000项输入到可交互P95<500ms。每项至少30热样本，另列首次调用。Node24.22.1、Windows10.0.26200、Ryzen9700X/16逻辑核、RAM50,634,108,928 bytes，SQLite/回环HTTP，均非生产负载或OS缓存冷启动。

最终后端代码5740bd8的E0矩阵见 [capacity.json](validation/batch-e/capacity.json)：100/500/1000项、20层、链式/扇出/2600工作日、100/1000历史，日期合法。

| 项目 | 30热样本P95 / max ms |
| --- | --- |
| 排期100：链式 / 扇出 / 长工期 | 1.095/1.163；1.015/1.322；0.862/1.095 |
| 排期500：链式 / 扇出 / 长工期 | 5.588/5.643；5.212/5.272；4.243/4.796 |
| 排期1000：链式 / 扇出 / 长工期 | 10.519/10.829；10.046/11.308；7.676/12.000 |
| 完整元数据list：100任务×100历史 / ×1000历史 | 0.212/0.214；3.083/3.115 |
| 完整元数据list：1000任务×100历史 / ×1000历史 | 0.239/0.310；7.267/7.292 |
| HTTP首页 / 历史1000任务×1000历史（分页） | 1.367/1.447；1.046/1.967 |

完整元数据list仍为1查询/0 snapshot bytes，不把其1000条全量metadata耗时与50条页混称。E-C同负载旧新SQL/读取与响应字节、单次采用及500文章正文对照保留在 [E-C](batch-e-c-validation.md)，不是本页轻首页样本的替代。E0矩阵harness maxRSS186,593,280 bytes；文件子进程峰值采样505,708,544 bytes，不能与旧大历史进程RSS当作同一文件负载对比。

另重跑E-B组合，见 [files.json](validation/batch-e/files.json)：2 Excel100浅层、2 XML1000/20层、1 PDF100长工期，5请求同时发出，每25ms持续普通接口与心跳；1冷轮+30热轮/150热文件。P95用排序后ceil(0.95n)，记录全部轮次与源哈希。

| 五文件并发热运行 | 样本 | P95 ms | 最大 ms |
| --- | ---: | ---: | ---: |
| 整轮文件完成 | 30 | 914.64 | 947.77 |
| 编辑心跳 | 767 | **7.83** | 17.66 |
| 普通接口 | 767 | **1.70** | 2.92 |
| 排队 | 150 | 104.76 | 123.66 |
| worker执行 | 150 | 798.55 | 839.53 |
| worker内部计算 | 150 | 798.08 | 839.08 |

冷轮905.24ms、心跳P95/max7.05/7.19ms、普通接口3.07/6.30ms。峰值2worker/3等待、maxRSS536,600,576 bytes（511.74MiB），事件循环采样最大28.93ms；末尾心跳成功，零错误、租约存活。字节/heap/活跃数边界有回归，采样RSS不是全程硬上限。原D9/E-A心跳1120.34ms超预算记录不改。

浏览器首次+30热样本及原始数组见 [browser-1000.json](validation/batch-e/browser-1000.json)、[受控1280](validation/batch-e/browser-1280.json)、[1680](validation/batch-e/browser-1680.json)、[原异常尺寸1701](validation/batch-e/browser-1701.json)。可交互度量沿用E-A输入事件→两次rAF；保存另含800ms防抖，不拿保存总时长套500ms预算。早期当前控制器P95/max61.8/62.1ms；同IAB旧E0控制器参考3554.1/3994.2ms，但当时未固定视口，不能把全部差额精确归因。

新增未固定视口复测曾出现约2秒帧等待，保留 [失败数组](validation/batch-e/browser-final-intermediate.json) 及截图，没有覆盖为通过。随后在进一步性能改动前登记 [测量条件](validation/batch-e/browser-measurement-protocol.md)：固定1280×900、1680×1050、原异常1701×1232，30热输入P95/max分别65.7/67.9、69/72.4、64.1/65.3ms，同步input处理约0.3ms；原异常未稳定复现，未声称已证明其唯一根因。短空闲及每800ms一次的长空闲控制另留证据，不扣除控制值来制造通过。

随后消除负责人/备注保存的可避免整行替换，增加输入节点身份回归（其他显示字段改变仍走更新路径）。**最终提交a4b4331** 在1701×1232分栏/周视图、实际1000行、首次+30热样本：输入P95/max **65.3/65.8ms**，保存确认P95/max **916.5/923.7ms**；31次均为原输入节点、逐样本视口稳定，见 [browser-final.json](validation/batch-e/browser-final.json)、[最终截图](validation/batch-e/browser-final.jpg)。末行焦点/光标和值、双pane scrollTop=43227均保留，见 [最终滚动数值](validation/batch-e/browser-final-scroll.json)。因此记录的受控环境通过原输入预算；未受控异常保留为未稳定复现的残留观察，发布前在实际前台浏览器继续关注，不宣称已从业务代码证明并消除其唯一原因。

最终代码全部被测后端源哈希与5740bd8测量一致，PDF及样本/验证器源码也未变；7份PDF及源码摘要见 [final-provenance.json](validation/batch-e/final-provenance.json)。前端精修不冒称重新测量了另一套后端，已通过PDF渲染不因仅客户端变更而重复生成无关二进制。

## 命令、隔离与清理

```text
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test tests/timing-edit.test.ts
node --experimental-strip-types --test tests/e-format-boundaries.test.ts tests/e-recovery.test.ts
node --experimental-strip-types scripts/check.ts
node --experimental-strip-types scripts/e-recovery-drill.ts docs/validation/batch-e/recovery.json
node --experimental-strip-types scripts/benchmark-e-a.ts docs/validation/batch-e/capacity.json
node --experimental-strip-types scripts/benchmark-e-b.ts docs/validation/batch-e/files.json
node --experimental-strip-types scripts/e-pdf-fixtures.ts .deploy/batch-e-pdf
python scripts/validate-e-pdf.py .deploy/batch-e-pdf docs/validation/batch-e
```

完整入口类型检查、190/190及Git空白检查退出0，见 [check.log](validation/batch-e/check.log)。Python使用本机已装的Codex依赖（pdfplumber/Pillow）和Poppler，无额外安装。首轮沙箱回环EACCES获准本机重跑，不降低产品检查；此最终完整记录已通过。未运行远程CI、不声称生产检查通过。

全部测试/基准用mkdtemp独立数据，不传生产DATA_DIR。完整检查确实重生成两个D2/D3样例；运行前均Git干净，先备份，再保存生成现值并校验SHA256，恢复原副本。原XLSX `71b0a907ac0daacc051e4ff0431488737864c95d417f7c5030cb0ab13bd1cb3e`、PDF `0f8edb8114deca715044812d83068da22553faf17da84849ad00466e87f77d6f` 均恢复；副本/manifest留在忽略 `.deploy/batch-e-final-samples/` 与最后一轮 `.deploy/batch-e-final-row-samples/`。用户原 `.gitignore`、`docs/batch-b-validation.md`、未跟踪AGENTS.md不暂存。D9审查原文不变。

浏览器代理日志只取时间/方法/路径/故障，见 [browser-requests.json](validation/batch-e/browser-requests.json)；不含cookie、请求体、密码或工作簿密钥。临时DB、大PDF/全量中间PNG不提交。服务停止及端口/进程检查见 [browser-cleanup.json](validation/batch-e/browser-cleanup.json)；测试目录可保留用于追溯，死锁不自动偷取。

## 后续与 F 准入

本地E核心缺口在记录的受控验收环境关闭；原未受控帧异常未稳定复现，保留为后续浏览器复测观察。目标机器部署资源、首次迁移耗时、正式停写备份/配套回退属于另行授权的发布工作。单进程/内存会话及Project桌面互操作限制保持明确，没有因本机通过而承诺生产容量。

用户已确认F首期为**项目预算、实际成本明细、分类汇总**；币种、税口径、录入/确认、更正方式明确后续按实际项目填写。[F准备材料](batch-f-readiness.md)提供候选字段、金额样例、权限/审计/幂等/文件/恢复约束及F0–F4顺序。没有新增财务表/API，不猜测并实现未确认流程。可以进入该范围F0；F1开工前将实际项目口径记录清楚。
