# A–C 正式部署记录

时间：2026-10-25（Asia/Shanghai）。用户明确授权最终测试、部署指定工作服务器，随后补充授权推送 GitHub main 并执行 CI；备份选择为服务器快照及本机独立副本，暂不接入外部存储/通知渠道。附件中的历史“未授权部署”描述作为历史事实保留，不作为本次请求的替代指令。

## 发布结果

- 正式地址：<https://www.l-sopp.com/>。
- 服务器：67.230.188.116；服务账号 pm-web，单进程；Node v24.22.0，仅监听 127.0.0.1:3000，由 Nginx 提供 HTTPS。
- 运行提交：`2889a0dc6544ce10c6b0efc1ed98b332fd55d291`。源码目录 `/WWW/pm-web-releases/2889a0d`，入口指针 `/WWW/pm-web-current`；正式数据仍为 `/WWW/PM WEB SITE/data`。
- 本轮运行提交：`6b51113`（正式副本迁移保留验证）、`2889a0d`（生产备份/健康检查）。本记录是后续文档提交，不改变运行版本。
- 22:30:29 开始切换；维护模式内取得最新代码/数据/配置快照，再迁移、启动、核验及解除维护，总切换 **7 秒**。备份/切换共享独占运维锁；切换脚本具备失败时配套恢复代码、配置和数据的处理。

## 最终验证

| 项目 | 实际结果 |
| --- | --- |
| Windows | pnpm 11.25.0 冻结锁文件离线安装；pnpm check：68/68、类型及差异检查通过。首次沙箱执行的 EACCES/EPERM 属于环境阻断，经允许执行环境完整重跑通过 |
| Linux | 冻结锁文件安装后运行同一 scripts/check.ts：68/68，0 失败；真实成套恢复演练通过，总耗时约 10.1 秒，夹具端口全部关闭 |
| 远程 CI | [GitHub Actions 40202046273](https://github.com/jerryju-stack/PM-WEB-SITE/actions/runs/40202046273)：提交 2889a0d，completed/success |
| 正式副本迁移 | 保留 3 个账号、3 个项目、2 篇文章、40 个任务、10 条依赖及 1 个附件；逐项核对旧列/旧账号字段及附件 SHA-256；账号原有 salt/hash 不变；迁移 001–004 完成 |
| 配套恢复 | 正式数据副本的 C 快照恢复成功；旧代码和旧数据也在独立副本恢复启动成功。两者均使用只加入隔离副本的随机验收账号，实际登录、读取全部项目/任务和下载附件，摘要一致；匿名读取 Timing/附件拒绝 |
| 生产快照再次恢复 | 生产 backup.service 生成的最新快照恢复到专用目录，实际隔离登录、读取 3 项目/40 任务、下载 1 附件及 Secure/HttpOnly/SameSite=Strict 检查通过。验收账号没有写入正式数据 |
| 文件对账 | missing/corrupt/orphan/pending 均为空；1 个旧附件仍为 legacy（历史 sha256 列为 NULL），备份清单对实际字节另行计算 SHA-256，不伪造历史摘要 |
| 上线后 HTTP | 本机及外部 HTTPS 首页 200，CSP/requestId 存在；所有前端脚本与样式 200；匿名账号接口 401、Timing 401、跨来源写请求 403；匿名聚合账号为空、user 为 null |
| 安全配置 | COOKIE_SECURE=1；仅信任 127.0.0.1 代理；Nginx 覆盖客户端转发头，IP HTTP 跳转 HTTPS 域名；证书至 2027-01-22 有效。数据目录/文件为 pm-web 的 700/600，源码 root 管理、服务只读，Git 元数据与备份限 root |

原账号没有改密或重置。旧项目没有按姓名自动分配成员；普通账号的编辑能力须由管理员按稳定身份显式分配。系统重启后原会话失效，需要重新登录。

## 备份、监控与独立副本

- 预演原始快照：`/WWW/pm-web-backups/abc-preflight-20261025T142641Z`，取一致快照/重启共 1 秒。
- 实际切换快照：`/WWW/pm-web-backups/abc-cutover-20261025T143029Z`，包含切换前代码、数据、Nginx/systemd 配置及迁移后首份 C 快照。
- 受管备份：`/WWW/pm-web-backups/managed`。生产 pm-web-backup.service 手工触发验证 Result=success/ExecMainStatus=0，快照阶段约 63ms，停服至恢复共 **2 秒**；不是全天 RTO 响应演练。
- pm-web-backup.timer 已启用：Asia/Shanghai 每天 **00:30、12:30**，持久化补执行；下一次为 2026-10-26 00:30。每次停止全部服务写入、一致复制/校验，再重启。失败或超过预算返回非零；完整快照至少保留 30 天，未启用永久删除。
- pm-web-monitor.timer 已启用，每 **15 分钟**检查服务、HTTPS、至少 1 GiB 剩余空间、备份新鲜度/RPO/错过窗口。首次生产检查成功。失败在 systemd/journal 中可见，**没有外部通知送达，也没有确认全天值守**。
- 服务器独立包：`/WWW/pm-web-backups/independent-2889a0d.tar.gz`，含受管快照、配套源码 Git bundle、部署配置及验证摘要。
- 本机副本：工作区忽略目录 `.deploy/production-backups/`；ACL 限当前用户与 SYSTEM。`preupgrade-original.tar.gz` 为升级前配套副本，SHA-256 `788b4c2eb059f711e5047463a5eb19b45b70b23a6f89c82379d0f82dadb772a0`；`production-2889a0d.tar.gz` 为最新生产快照/代码/配置，SHA-256 `04a7839a2c4140437de22425496bd2841cc8453df12c192a0b4b04a4798bdf5e`。下载后与服务器摘要完全一致，均未纳入 Git。
- 本机副本为本次手动取得的独立恢复点，**没有自动异地同步**。24h RPO/全天 8h RTO 仍为运营目标；没有将一次小规模恢复与已启用服务器 timer 写成持续异地灾备或全天响应已经兑现。

## 仍保留的验收边界

A 的原生 confirm/beforeunload 确认、取消及关页全分支仍未完成人工签收。本轮在全新临时浏览器夹具登录并打开项目草稿；切换到原生 Chrome 控制时，工具因无法可靠识别当前页面停止 Computer Use，随后停止所有浏览器操作并关闭测试服务，没有把操作尝试写成通过。自动草稿/读取乱序测试继续通过，但不替代原生分支。多浏览器/移动矩阵、断电/硬件故障、容量压力及全天故障响应未在本轮认证。

GitHub 推送最初被自动审批拒绝（原请求只指定服务器）；获得用户明确补充授权后推送 main 成功，远程 CI 已实际通过，不存在该项遗留阻塞。

## 恢复操作要点

先进入维护、停止 pm-web 并取得故障现场快照，按 manifest 的 codeVersion 选择配套源码；用 data-maintenance.ts restore 恢复到新目录，离线核验和隔离启动成功后才切换。C 数据不得交给旧代码直接使用；不能仅 git revert 或覆盖一个 SQLite 主文件。需要退回本轮之前时须使用切换前配套代码、数据和配置，快照之后的写入不自动保留。授权异常应维护或拒绝访问，不能退回全员访问。

值班检查：`systemctl status pm-web pm-web-backup.timer pm-web-monitor.timer`；详情：`journalctl -u pm-web-backup.service -u pm-web-monitor.service`。受管备份手动执行：`systemctl start pm-web-backup.service`。恢复期间暂停相关 timer，切换后重新启用并核验恢复点。
