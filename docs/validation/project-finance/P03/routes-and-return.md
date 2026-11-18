# P03 路由与返回矩阵

2026-11-17 · P03-A-en-v1。下表的 `F` 表示 `/projects/:id/finance`，:id 对应主网站已有项目。所有页面须在 FINANCE_PROTOTYPE=1 的本地服务器中访问。

| 入口 | 目标 | 返回与恢复 | 核验 |
|---|---|---|---|
| 主网站一级 Project Finance | /finance | Project Overview 返回主网站项目列表 | 桌面、窄屏通过 |
| 网站项目卡 Project Finance · Sample | F | 保留所选项目 ID，提供 Project Overview | 桌面、窄屏通过 |
| Switch Project | /finance → 另一项目 F | 重新匹配可见项目与有效筛选值 | 桌面、窄屏通过 |
| Revenue | F/commercial | 返回原指标卡、筛选与焦点 | 路由刷新通过 |
| Operating Profit / Margin | F/operations | 返回原利润卡及滚动位置 | 完整路径通过 |
| NPV / IRR / Payback / Peak Funding | F/returns | 财务首页链接或返回来处 | 路由刷新通过 |
| Budget Execution | F/budget | 财务首页链接或返回来处 | 路由刷新通过 |
| Version Comparison / 差异摘要 | F/compare | 返回仪表盘或进入源行 | 完整路径通过 |
| 工序列表 Assembly | F/operations/assembly-01 | Back to Manufacturing & Labor，再返回原利润卡 | 完整路径通过 |
| DV 差异行 | F/validation/dv-01 | Back to Version Comparison，恢复原差异行与滚动、焦点 | 完整路径通过 |
| Commercial & Volume | F/commercial | 通用返回与仪表盘链接 | 直链刷新通过 |
| BOM & Purchasing | F/bom | 通用返回与仪表盘链接 | 直链刷新通过 |
| Manufacturing & Labor | F/operations | 源行与仪表盘往返 | 直链刷新通过 |
| Factory Costs & Launch | F/factory-costs | 通用返回与仪表盘链接 | 直链刷新通过 |
| Engineering & PM Hours | F/engineering | 通用返回与仪表盘链接 | 直链刷新通过 |
| Prototypes & Builds | F/prototypes | 通用返回与仪表盘链接 | 直链刷新通过 |
| Validation & Certification | F/validation | DV 源行与仪表盘往返 | 直链刷新通过 |
| Equipment & Investment | F/investment | 通用返回与仪表盘链接 | 直链刷新通过 |
| Working Capital & Returns | F/returns | 逐期现金流与仪表盘往返 | 直链刷新通过 |
| Budget & Versions | F/budget | 预算摘要与仪表盘往返 | 直链刷新通过 |

## 恢复与离开

- URL 查询项为 baseline、version、period、product，临时编辑值保留在页面状态中。
- 每个历史条目保留 finance 页面序号、源 URL、滚动位置与焦点 ID。显式返回和浏览器前进、后退使用同一历史。
- 未保存离开时展示 Keep Editing / Discard Changes。取消浏览器后退后回到原源行并保留候选，放弃后继续原返回动作。
- 直接打开明细且无来路时，提供财务仪表盘以及对应列表/报告的返回入口。
- 无效项目显示 Project unavailable。项目可见集合沿用主网站现有列表，真实财务权限在 P04 定义。
- 鼠标、键盘与触屏释义均以同一英文说明渲染。Esc 或 Close 后焦点回到信息按钮。

断言逐项见 [浏览器实测](browser-checks.json)，界面证据索引见 [P03 说明](README.md)。
