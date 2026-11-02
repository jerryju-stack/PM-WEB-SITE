# D9 Timing Microsoft Project XML 导入导出

入口：Timing 的“导出 / 导入”面板增加“导出 Project XML”；原上传入口接受 `.xlsx` / `.xml`。界面布局、权限、版本选择和共享草稿确认流程沿用现有实现。未部署服务器。

本批经用户确认采用 Microsoft Project XML（MSPDI，命名空间 `http://schemas.microsoft.com/project`），不支持原生二进制 `.mpp`。复用 `fast-xml-parser`，没有新增依赖。

## 数据映射与限制

- 任务名称、Contact 负责人、Notes 备注、数字大纲/WBS、层级、Start/Finish、完成度、里程碑和无延迟 FS 依赖。
- 导出文件按任务顺序生成数字 UID，依赖使用 PredecessorUID；网站身份仍沿用现有 WBS 匹配及手动选择机制。文件 UID 不作为可信网站 ID。自定义 WBS 转成数字大纲并提示。
- 日期保留 XML 日期部分，不做时区换日；网站不保存时分秒。导出采用 08:00–12:00、13:00–17:00，周一至周五，每天 8 小时。普通任务导出开始不早于原开始日约束，避免 Project 自动提前任务。
- 导入工期校验采用 ISO 时间段与 MinutesPerDay 换算，最终仍按起止日期的整工作日重算。工期不一致会提示；排期变化可在预览查看。无日期叶子任务需要补全日期。
- XML PercentComplete 是整数，导出完成度四舍五入；汇总进度按网站规则重算。
- 仅支持文件内无延迟 FS 依赖；其他类型、延迟和跨项目依赖阻止确认。自定义日历、资源分配、成本、实际工时、其他约束及基线数据不导入，预览提示限制。
- XML 导入最多 8 MB、1000 项任务、20 级层级；支持 UTF-8、带 BOM 的 UTF-16 和命名空间前缀。拒绝 DTD/实体声明、错误命名空间、损坏 XML、重复 UID 和无法解析的依赖。
- 全部解析并校验后才生成可确认预览，确认时复用现有草稿事务、修订检查及编辑会话检查；缺少任务默认保留，建立新计划沿用原适用条件。

## 最小检查

- `node node_modules/typescript/bin/tsc --noEmit`
- `node --experimental-strip-types --test tests/timing-project.test.ts tests/timing-transfer.test.ts`
- 小样例覆盖普通任务、空汇总阶段、父子层级、里程碑、FS 依赖、日期/工期/进度/名称/备注往返、已有任务身份匹配及建立新计划。
- 无效 XML、DTD、错误命名空间、非 FS 依赖、未知依赖 UID、重复 UID 无法生成可确认预览，草稿和执行计划均未部分写入。
- 原导入界面操作测试通过；未执行全量测试。未使用 Microsoft Project 桌面版实际打开验证，不能据此宣称已完成桌面互操作验收。

格式参考：[Microsoft Tasks XML schema](https://learn.microsoft.com/en-us/office-project/xml-data-interchange/xml-schema-for-the-tasks-element?view=project-client-2016)、[Project XML schema](https://learn.microsoft.com/en-us/office-project/xml-data-interchange/xml-schema-for-the-project-element?view=project-client-2016)。
