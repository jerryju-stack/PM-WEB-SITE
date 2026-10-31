# D8 正式部署记录

2026-10-31（Asia/Shanghai）。按用户明确授权 push 并上线正式服务器。

- 正式地址：[Project Station](https://www.l-sopp.com/)。运行提交为 aac691395e5149aee66bedee7ad133a3d6cf7c69，包含 D8 实现 894e9d9 和 CI 兼容性修复；运行目录 /WWW/pm-web-releases/aac6913，入口 /WWW/pm-web-current。
- GitHub main 已推送；[运行提交 CI](https://github.com/jerryju-stack/PM-WEB-SITE/actions/runs/41171977356) 类型检查及 89/89 测试通过，0 跳过。首次 CI 发现旧迁移夹具未移除 D8 结构、旧权限测试仍直接写执行计划，已修正，并保留跨项目任务请求的 404 行为。
- 服务器类型检查通过，复用与上一版一致的 package.json / 锁文件依赖。沿用原服务账号、正式数据目录、Nginx、HTTPS 和 Cookie 配置。
- 先停写复制正式数据，再恢复旧服务，在隔离副本验证迁移与实际 HTTP 草稿流程；副本预检维护约 3 秒。正式切换再次停写并取得最新恢复点，迁移 007 后切换发布指针，维护约 4 秒。未触发回退。
- 迁移逐列比对全部 16 个既有业务表，原记录保持一致；4 项目、86 任务、55 依赖、3 账号、2 文章及 1 附件保留，账号凭据字段与附件字节一致。4 个 D8 新表初始为空，不补造草稿或历史。
- 正式数据副本验证：真实登录与 Cookie 标志、现有项目读取和附件下载；新增隔离项目验证草稿不改变执行计划、同账号第二页面被拒绝、一键采用与幂等、采用后保持占用、退出继续共享草稿、归档为未采用及基线只读。验证账号和任务只写入副本，未写入正式库。
- 公网首页 200；7 个脚本与运行 Git 提交的转译结果一致；匿名私有排期、版本和草稿接口拒绝访问。pm-web、nginx、备份和监控 timer 均 active，手动监控检查 Result=success / ExecMainStatus=0，维护标记已清除。

恢复记录目录：/WWW/pm-web-backups/d8-20261031T052006Z。包含升级前数据、切换前最新数据、升级后快照、配套新旧 Git bundle、服务 / Nginx 配置、脚本和验证结果。配套恢复包为 recovery-aac6913.tar.gz；本机独立副本为 .deploy/production-backups/d8-aac6913.tar.gz，未纳入 Git，沿用既有受限目录权限。两端 SHA-256 一致：744351cb2a70fad2c49701779cbf37cb01c4e54d3b78d2f972e3c0550ffb14b6。

若日后回退，须先停止写入并保存最新现场，再按配套代码与数据恢复；迁移 007 数据不能直接交给旧代码。服务重启使旧登录会话失效，使用时刷新并重新登录。本记录单独提交，不改变运行代码；工作区原有 .gitignore、docs/batch-b-validation.md 和 AGENTS.md 保持未提交。
