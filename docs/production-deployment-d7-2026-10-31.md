# D7 量产部署记录

## D7 增量：日 / 周 / 月全宽及完整项目横向浏览

2026-10-31（Asia/Shanghai），按用户本次明确授权完成增量提交、push 和上线，继续归入 D7。

- GitHub main 已推送运行提交 `33855f9991ce8ed24c75319634cf2ce301b31238`。发布目录 `/WWW/pm-web-releases/33855f9`，入口 `/WWW/pm-web-current`；上一版 `/WWW/pm-web-releases/2cdb98c` 保留。
- 日 / 周 / 月保持原日期间距，日历覆盖全部有效任务日期并至少铺满视口；底部原生横向滚动条及空白 / 日期表头拖动均可浏览项目首尾。窗口和模式切换后局部适配，保留日期上下文；全项目视图保留。功能和 3372px 真实浏览器检查见 [D7 增量验证](d7-validation.md#d7-增量日--周--月完整范围及横向拖动)。
- 发布前核对 Git bundle 摘要和提交、脚本语法；依赖清单、锁文件、服务端入口、全部 `lib/` 和 `ops/` 与上一版一致，复用已安装依赖，无数据库迁移。未对生产项目、任务、账号发起验收写入。
- 沿用维护锁、维护标记、原子发布指针切换和失败自动回退；维护约 **2 秒**。内部及正式 HTTPS 首页、新旧两个模块和样式均检查通过；最终 `pm-web`、`nginx`、`pm-web-monitor.timer` 均 active，维护标记已移除，未触发回退。
- 从本机外网读取正式 HTTPS 资源，两个脚本 MIME 正确，脚本与提交源码剥离类型后的结果逐字一致，样式与 Git blob 一致。SHA-256：`timing.js` 为 `3225ec376a5cdd00c1ca3d793f4f1467e8006ed53a2c79f02d9f950cf9073306`；`timing-layout.js` 为 `1cfc82b4e11f4c33f79e5be46fcbd7fca88e73834500d2c3682141fd564b8da8`；`timing.css` 为 `1d45a186f0b36eea10c9dc1eb64eba8780964965caec41b885cba0b7a261380c`。
- 备份和上线校验记录目录 `/WWW/pm-web-backups/d7-scroll-20261030T164454Z`，含旧发布指针、旧代码 bundle、服务配置、部署脚本和内外网返回资源。回退沿用保留旧代码和现有业务数据，未生成新的数据快照。

仅执行类型、D7/D6 相关 5 项定向检查、隔离本地浏览器验收及必要上线检查；未运行完整测试套件或全站回归。部署记录另作文档提交，不改变运行代码；原工作区三项无关改动继续保留。

## D7 首次部署

2026-10-31（Asia/Shanghai），按用户明确授权 push 并上线量产服务器 `67.230.188.116`。

- GitHub main 已推送功能提交 `2cdb98c20075594dc03ba36bb667da0f452c8762`。
- 正式入口：[Project Station](https://www.l-sopp.com/)。进入项目 Timing，可在排期工具栏切换「仅详细信息 / 分栏显示 / 仅甘特图」，拖动中间分隔栏调整比例，双击或 Home 重置。
- 运行目录 `/WWW/pm-web-releases/2cdb98c`，入口 `/WWW/pm-web-current`。上一版 `/WWW/pm-web-releases/bccec33` 保留。
- 使用既有部署锁和维护标记、发布指针原子切换、失败自动回退，重启 `pm-web`；维护约 **5 秒**。最终 `pm-web`、`nginx`、`pm-web-monitor.timer` 均 active，维护标记已移除，未触发切换后的回退。
- 依赖清单、锁文件、全部 `lib/` 及 `ops/` 与上一运行版一致，复用已安装依赖。`server.ts` 严格比对确认仅增加 `/timing-layout.js` 静态模块映射，运行环境已成功剥离新模块 TypeScript 类型。无数据迁移，未通过业务接口修改真实项目、账号或任务。
- 内部服务首页及正式 HTTPS 首页可用；`timing.js`、新增 `timing-layout.js` 均与运行提交对应源码剥离类型后的结果逐字一致，内部和公开资源一致。从本机外网再次访问正式 HTTPS 地址，确认两个脚本 MIME 正确，脚本及样式逐字比对运行提交通过。
- 正式资源 SHA-256：`timing.js` 为 `c467dfc0f6b5a71f965cdd5429b2b270ff488437e33cc56d64b8f631030a697d`；`timing-layout.js` 为 `1cfc82b4e11f4c33f79e5be46fcbd7fca88e73834500d2c3682141fd564b8da8`；`timing.css` 为 `a2123a25869d3970c857488e3b661ba9a76b52636a54134600d14f7ca756061f`。
- 发布备份和校验记录位于 `/WWW/pm-web-backups/d7-20261030T162226Z`，保留旧发布路径、代码 bundle、服务配置、部署脚本、内外网资源及部署结果。此次未生成数据快照，回退沿用保留的旧代码和现有数据。

首次准备阶段的摘要检查识别了本机工作区 CRLF 与 Git 提交 LF 的差异，在创建维护标记、切换或重启之前停止，量产服务未受影响。核对 Git blob 与服务器文件完全一致后，使用提交内容的摘要继续，最终成功上线。

本轮仅执行必要发布检查，未重复完整测试套件、全站回归或在生产写入验收数据。功能及真实浏览器定向检查见 [D7 验证记录](d7-validation.md)。部署记录以独立文档提交保存，不改变已运行的 D7 代码。工作区原有 `.gitignore`、`docs/batch-b-validation.md` 和 `AGENTS.md` 改动未纳入提交或发布。
