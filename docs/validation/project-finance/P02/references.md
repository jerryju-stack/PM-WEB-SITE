# P02 参考筛选记录

检索与打开日期为 2026-11-17。公共查询只使用 Power BI、SAP Fiori、Tableau、financial dashboard、overview page 等通用词。稿件数据来自 P01 的虚构例扩展。浏览器实际查看了 Microsoft 的 Plan Variance 图和 Tableau Financial Statement Home 图。

| 方向与来源 | 定位到的具体画面 | 借鉴元素 | 在本项目中的取舍 |
|---|---|---|---|
| A · 计划指定的 [Microsoft Corporate Spend](https://learn.microsoft.com/en-us/power-bi/create-reports/sample-corporate-spend) | Plan Variance Analysis 的差异条形图和按月差异表。[原图](https://learn.microsoft.com/en-us/power-bi/create-reports/media/sample-corporate-spend/power-bi-plan-variance.png) | 汇总差额旁保留分项，允许从最大偏差进入来源。 | 采用现金曲线与差异表并列，六组回报值先出现。较窄卡片的中文标签和利润率差需换行。 |
| B · 计划指定的 [SAP Fiori Overview Page v1.120](https://www.sap.com/design-system/fiori-design-web/v1-120/page-types/floorplans/overview-page) | 当日重新打开。文本工具仅返回标题及 SVG 图标，浏览器返回 Access Denied。 | 卡片围绕任务组织的原则由可检索的官方 v1.84 说明核对。 | 此来源的实际界面图核验受限。B 的卡片视觉同时使用下列 Microsoft 可访问实图补证。 |
| C · 计划指定的 [Tableau Financial Statement](https://exchange.tableau.com/products/559) | Financial Statement Home。左侧品牌导航，中部 Income Statement / Balance Sheet 两区，右侧按任务进入 What-If 等报告。[原图](https://galleryapi.tableau.com/productfiles/559/01_CORPORATE%20FINANCE%20-%20Financial%20Statement-Home.png) | 指标概览、报告入口与情景分析共用上下文。页面说明列有 Waterfall 和 What-If Analysis。 | C 用左侧紧凑指标清单、右侧利润变动与改数入口。瀑布图适合解释变更，常规预算浏览需继续下滚。 |

## 有实图的替代方向

| 来源 | 具体画面与采用情况 |
|---|---|
| [Power BI Customer Profitability](https://learn.microsoft.com/en-us/power-bi/create-reports/sample-customer-profitability) · [仪表盘原图](https://learn.microsoft.com/en-us/power-bi/create-reports/media/sample-customer-profitability/power-bi-dash.png) | 卡片中同时展示汇总值与小图，按主题分区。用于 B 的分组卡片和报告入口组织。原图含更多角色信息，本稿仅保留项目任务。 |
| [SAP Overview Page v1.84](https://www.sap.com/design-system/fiori-design-web/v1-84/page-types/floorplans/overview-page) · [SAP Overview Pages 说明](https://help.sap.com/docs/ABAP_PLATFORM_NEW/468a97775123488ab3345a0c48cadd8f/c64ef8c6c65d4effbfd512e9c9aa5044.html) | 检索到固定/可调整卡片布局、按任务进入和响应式列的说明。设计站点实图访问受限，作为结构依据。 |
| [Tableau Waterfall 展示页](https://exchange.tableau.com/products/1127) | 检索并打开正负变动、起止总计和差异残额的说明及画廊。用于明确 C 的起点、驱动、终点和未解释额。第三方扩展与本稿的手绘 CSS 图分别保留各自实现。 |

公开参考保持原站链接。网页中的图表用本项目虚构数据重新绘制。三个候选稿均取站内背景 #141518、面板 #1D1E23、强调色 #8580F5、成功色 #80C4A2 与不利色 #EB929C，使用已有系统字体。比较桌面统一为 1440 × 1000，窄屏统一为 390 × 844。

建议以 A 为讨论起点。其六组值、现金低点和主要差额在桌面首屏中相邻。B 给数值和标签更多空间，C 将单项变更的解释放在前面。选择由用户实际回复后登记。
