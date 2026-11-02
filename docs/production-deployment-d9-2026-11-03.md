# D9 正式服务器部署记录

2026-11-03（Asia/Shanghai），按用户明确授权推送 GitHub `jerryju-stack/PM-WEB-SITE` 的 `main` 分支并部署正式服务器。

- 正式地址：[Project Station](https://www.l-sopp.com/)。运行提交 `0b3f05fa441269df71737e87c71d5756847ded6a`，发布目录 `/WWW/pm-web-releases/0b3f05f`，入口 `/WWW/pm-web-current`。上一版本 `/WWW/pm-web-releases/306f47b` 已保留。
- 本批为现有导出／导入模块增加 Microsoft Project XML（MSPDI，`.xml`）入口，用户已确认采用该格式；不支持原生 `.mpp`。功能范围及限制见 [D9 检查记录](batch-d9-validation.md)。
- 依赖清单、锁文件和数据库实现与运行旧版一致，没有新增依赖或数据库迁移；沿用现有服务账号、数据目录及 Nginx 配置。
- 发布前服务器类型检查及两项定向测试通过；独立临时数据库的 HTTP 验证通过：XML 下载和响应头、预览后确认导入、无效 XML 返回 400、匿名导出返回 401。验收没有写入正式业务数据。
- 使用发布锁及维护标记，停写后复制完整正式数据，切换发布指针并启动服务，维护约 3 秒；未触发回退。
- 服务切换后逐表比较部署前副本与正式库：22 张表内容一致，4 个项目、86 项任务保留。
- 正式服务返回的 `timing-io.js` 与运行提交转译结果一致；公网首页、脚本、样式返回成功；pm-web、nginx、备份和监控 timer 均 active，维护标记已清除。
- 服务器恢复点：`/WWW/pm-web-backups/d9-20261102T163854Z`，含切换前数据、配套新旧 Git bundle、服务及 Nginx 配置、部署脚本和检查结果。恢复包 `recovery-0b3f05f.tar.gz`，SHA-256：`aab10e13f1d856cfbe7e9d38987e73aebd34226e274e2b7ee3e1ed51a5ce1c7e`。
- 自动审批拒绝把含正式数据库的恢复包导出到本机；恢复包保留在服务器受限备份目录，未纳入 Git。

未执行全量测试，未使用 Microsoft Project 桌面版实际打开验证。代码重启后如旧会话失效，请刷新并重新登录。部署记录另行提交；工作区原有无关改动保持未提交。
