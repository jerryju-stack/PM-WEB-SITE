# D6 正式部署记录

2026-10-30（Asia/Shanghai），按用户授权推送 GitHub main 并上线正式服务器 `67.230.188.116`。

- 运行提交：`03a09bde5864cbf340ef36b7ddcfe10ab14e7fee`。
- 正式地址：https://www.l-sopp.com/ 。进入项目 Timing，在日/周/月旁选择「全项目」。
- 发布目录：`/WWW/pm-web-releases/03a09bd`，入口 `/WWW/pm-web-current`；上一版 `/WWW/pm-web-releases/e50f8f7` 保留。
- 沿用部署锁、维护标记、发布指针切换和失败自动回退。维护约 3 秒，`pm-web` 和 `nginx` 均 active，监控定时器已恢复。
- 依赖、服务入口、数据库、迁移、排期与工作簿模块与上一运行版本相同，复用已安装依赖，无数据迁移，未修改真实项目数据。
- 服务内及公开 HTTPS 首页通过；`timing.js` 与发布源码去除 TypeScript 类型后的结果一致，内外网脚本相同；样式摘要一致：`abba24c42a61281b7707c8b3976f8b921df2b4020ed207dcf6e44570c04faf05`。
- 发布备份及校验记录：`/WWW/pm-web-backups/d6-20261030T073810Z`。

本轮仅做必要上线检查，没有重复全项目验证或独立 review。功能测试和未执行的浏览器目视验收见 [D6 验证记录](d6-validation.md)。部署记录以独立文档提交保存，不改变运行代码。
