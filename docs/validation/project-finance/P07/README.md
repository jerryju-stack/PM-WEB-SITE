# P07 主站项目财务接入

2026-11-18 · P02 选定的 A 布局与站内设计令牌 · P06.1 计算、预览和草稿保存。

本机正常首页为 [Project Station](http://127.0.0.1:18747/)。使用本机审核目录生成的账号登录后，从一级导航 **Project Finance** 选择项目，或从项目概览的项目卡直接进入。恢复自 P05 的 [CQA 项目](http://127.0.0.1:18747/projects/cqa-p05-local-validation/finance) 使用原项目 ID 和批准基线。页面的 **Sources** 可查看计算版本、口径、上游字段与工作簿单元格。项目卡标题和财务页 **Timing** 链接均可打开原排期页。

审核站点绑定回环地址，使用从 P05 备份恢复的隔离 DATA_DIR。账号仅用于该副本，存于被 Git 忽略的本地文件。路径可从 `.deploy/finance-p07/latest-run.json` 的 `credentials` 字段取得。CQA 批准基线有实际计算值，当前预测指针为空。隔离副本另有可手动选择的 CQA Review Draft 和独立的合成项目。合成项目有批准基线与当前预测，供差异与草稿写入检查。

## 页面与数据

- 一级入口使用已授权财务项目目录。唯一项目直达，多项目可选，**Switch Project** 可始终打开选择器。单个项目的界面读取由同一项目权限再次校验。数据接口也独立鉴权，按所选版本返回页面所需计算结果与引用来源。
- 六组指标、并列累计现金流与版本差异、预算摘要、十个模块入口沿用 A 布局。标准经营利润待财务签认时显示真实状态，CQA MPBITRI 以历史口径另列。预算按 P06 事件范围显示，缺数显示为缺数。数值与差额均由 P06 计算。
- URL 保存批准基线、查看版本、期间、产品和来源位置。收入和 CQA MPBITRI 随期间变化，现金曲线截至所选期。回报和标准经营指标保留全期口径，预算显示项目总量。选定产品后采用 P06 对应的产品范围计算。累计现金曲线同时标注全期回收和峰值期间。不同币种各自显示。
- 财务界面的按钮、状态和指标沿用英文，按 P07 请求补充同一 P01 字典的中文释义。鼠标悬停、键盘聚焦与触屏点按可展示，Esc 或关闭恢复触发位置。
- 源行详情打开固定 **Change Impact**，桌面停靠右下，窄屏使用可折叠底栏。沿用 P06 的权限、原修订、候选摘要与异步响应控制。预览显示生效期、前值、候选、差额、受影响产品/期间及依赖路径。冻结基线可由具备驱动编辑权限的成员预览，保存需选择草稿。只读账号可查看来源。
- 报表及模块的显式返回保留来处及焦点。浏览器返回与前进重建相同路由，源行可直接刷新。有未保存候选时，离开确认可以保留输入或放弃变更。

## 本机证据

| 核验内容 | 桌面 1440 × 1000 | 窄屏 390 × 844 |
|---|---|---|
| 合成项目的六组指标、差异、累计现金流和模块入口 | [财务首页](desktop-dashboard.png) | [财务首页](mobile-dashboard.png) |
| 通用影响面板 | [制造人工预览](desktop-impact.png) | [制造人工预览](mobile-impact.png) |
| 空财务状态 | [空项目](desktop-empty.png) | [空项目](mobile-empty.png) |

[无权账号深链](access-denied.png) · [逐项浏览器结果](browser-checks.json) · [完整检查](check-summary.json)

CQA 真实金额的桌面、窄屏首页和来源/预览截图存于本机 `latest-run.json` 所指 `directory` 的 `browser/`，文件名为 `{desktop,mobile}-cqa-{dashboard,source,impact}.png`。浏览器核验从正常首页登录，分别点击一级入口、原项目卡，并断言同一批准基线和同一 NPV。测试覆盖中文释义、期别/产品筛选、来源、真预览、返回与刷新、空项目、只读和无权账号，以及各报表/模块路径。

## 重跑

在仓库根目录运行以下命令。需要 P05 已记录的本机导入备份，浏览器验证使用 Chrome 和现有 Codex Playwright 依赖。

```powershell
node --experimental-strip-types scripts/finance-workspace-preview.ts
```

第二个终端执行以下命令。`P07_VERIFY_SAVE=1` 在合成草稿中保存修改、刷新复核并把输入恢复到夹具值。

```powershell
$env:P07_VERIFY_SAVE = '1'
node scripts/verify-finance-p07.mjs
node --experimental-strip-types scripts/check.ts
```

本地站点关闭后可用 `node --experimental-strip-types scripts/finance-workspace-preview.ts --reuse` 重开上次副本。全量命令等同于 `package.json` 的 `npm run check`。本机使用可连接回环地址的环境执行 HTTP 和浏览器验证。

## 后续业务页

| 阶段 | 路由与本步状态 |
|---|---|
| P08 | `/commercial`、`/bom`、`/factory-costs` 可进入。已接通的材料单价可预览，等待市场商务、逐物料落地成本与工厂费用维护页。 |
| P09 | `/operations` 已接 P06 制造人工驱动及共用面板。等待工艺路线设计、工位配平及实测替换。 |
| P10 | `/engineering`、`/prototypes`、`/validation` 显示待接入状态。等待开发工时、样机和验证的费用覆盖及明细。 |
| P11 | `/investment` 等待资产和补偿维护。`/returns` 已读出累计现金和逐期来源，等待完整回报及投资业务下钻。 |
| P12 | `/budget` 已显示 P06 预算摘要，等待预算及实际费用确认、调整与 ETC 维护。 |
| P13 | `/compare` 已展示所选版本及计算差额，等待金额归因桥与业务驱动逐项核对。 |
