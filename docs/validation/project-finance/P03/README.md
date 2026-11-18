# P03 主网站财务交互原型

2026-11-17 · P03-A-en-v1 · 使用 P02-A-v1.1-en 选定的 A 布局，财务界面采用英语。

## 本地审核入口

- [主网站首页](http://127.0.0.1:18743/) 的一级导航 Project Finance 可进入项目选择。
- [项目选择](http://127.0.0.1:18743/finance) 展示主网站可见的两个样例项目。
- [Sample Assembly Program 财务首页](http://127.0.0.1:18743/projects/p03-assembly/finance) 和 [Sample Platform Program 财务首页](http://127.0.0.1:18743/projects/p03-platform/finance) 可直接刷新。
- 网站项目卡上的 Project Finance · Sample 可直达该项目。项目标题仍进入原有 Timing。

运行命令为 `node --experimental-strip-types scripts/finance-prototype-preview.ts`。此脚本用独立的 `data/finance-prototype-p03` 目录准备两个虚构项目，再启用 `FINANCE_PROTOTYPE=1` 并启动现有 server.ts，默认监听 18743。样例目录由现有 .gitignore 的 data/ 规则覆盖。脚本在准备数据时使用现有目录锁。

## 可审核路径

1. Dashboard → Operating Profit / Margin → Manufacturing & Labor → Assembly · Station 01。将 CT 从 36 改为 42，点击 Preview Change。比较 Before edit · F02 时经营利润变化 −2,000 CNY，NPV 变化 −1,818.18 CNY。返回时可选择 Keep Editing 或 Discard Changes，放弃后经工序列表返回原利润卡并恢复焦点、滚动及筛选。
2. Dashboard → Version Comparison → DV retest package · VAL-01。将费用从 2,000 改为 3,000，预览得到利润 −1,000 CNY、Year 1 现金 −1,000 CNY、NPV −909.09 CNY。浏览器后退同样提供未保存离开提示，返回时定位原差异行。
3. 信息按钮支持鼠标悬停、Tab 聚焦、触屏点按，Esc 或 Close 收起后焦点返回触发按钮。
4. Baseline、Forecast、Period、Product 保留在 URL，前进、后退、刷新可重建。Switch Project 切换已有样例项目。Demo Draft 只在当前浏览器会话保存，重开源行可读回已保存候选。

## 实测结果

[浏览器记录](browser-checks.json) 包含桌面 1440 × 1000 的 40 项和窄屏 390 × 844 的 39 项断言，均通过。[检查摘要](check-summary.json) 记录类型检查、191 项仓库测试和 Git 差异检查结果。新增原型开关回归验证默认关闭时页面和资源返回 404，显式开启后可访问。

重跑浏览器核验前先启动上述服务器，再运行 `node docs/validation/project-finance/P03/browser-check.mjs`。脚本使用本机 Codex 依赖包的 Playwright 和 Chrome，访问回环地址，生成本目录截图及断言结果。路由与返回行为见 [矩阵](routes-and-return.md)。

| 截图内容 | 桌面 | 窄屏 |
|---|---|---|
| 主网站双入口 | [首页](desktop-website.png) | [首页](mobile-website.png) |
| 财务首页与模块 | [仪表盘](desktop-dashboard.png) | [仪表盘](mobile-dashboard.png) |
| 制造人工改数 | [预览](desktop-labor-preview.png) | [预览](mobile-labor-preview.png) |
| 试验源行改数 | [预览](desktop-validation-preview.png) | [预览](mobile-validation-preview.png) |
| 未保存返回 | [弹窗](desktop-unsaved-return.png) | [弹窗](mobile-unsaved-return.png) |
| 释义交互 | [Tab 聚焦](desktop-definition.png) | [触屏点按](mobile-definition.png) |

## 本步数据与后续交接

此版本供本地主网站交互审核，页面持续显示 Sample Data。项目身份来自现有项目列表，所有财务金额和业务源行均为虚构夹具。财务编辑过程的网络记录中没有应用写请求。

筛选项在本步用于导航上下文和恢复验证，指标卡与现金图展示完整项目样例，页面已注明。B00/F01 为切换上下文的样例选项。Save Demo Draft 使用 sessionStorage 保留候选，不修改当前预测和批准基线。其余业务模块展示可定位的示例源行，制造人工和试验费用两条路径提供改数预览。

P04 建立财务专用权限、版本及审计，P05 导入授权基线，P06 实现完整分期计算与预览服务，P07 用这些服务接入正式功能。该版本的手工示例计算只覆盖页面声明的 CT、费用和现金时点假设。

P03 技术交互核验通过，用户可从上述主网站入口审核。业务验收、真实财务权限、基线写入和生产访问按对应后续阶段登记。
