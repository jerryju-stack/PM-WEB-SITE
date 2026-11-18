# E-A 真实浏览器记录

日期：2026-11-03（Asia/Shanghai）。Chrome，Windows，回环代理 `http://127.0.0.1:10360`；数据目录为系统临时目录中的 `station-e-a-browser-OqrTu5`。仅合成项目 `browser-30` / `browser-1000`。以下是实际 browser-use DOM/只读属性观测摘录，不是 DOM 桩测试输出。相关请求序列见 `browser-requests.jsonl`（不含 Cookie、请求体或租约 token）。

## 已执行并观察到的正确性路径

1. **断网（代理销毁任务请求 socket）→ 退出编辑：**

   ```json
   {"status":"本地未提交输入已保留 · 重新进入编辑后比较恢复","input":{"disabled":true,"value":"E1-OFFLINE-INLINE"},"enterVisible":true}
   ```

   当时尚未追加失租后的 readonly 焦点保护；后续 409 抽屉路径已验证 readonly 的最终实现。

2. **第二页面实际占用：**同一账号的另一标签页取得真实服务器租约。原页面重新进入得到 `管理员 正在编辑，请等待退出或占用到期`（HTTP 409），本地值仍为 `E1-OFFLINE-INLINE`，恢复对话框数量为 0。第二页面将共享草稿负责人改为 `SECOND-PAGE-LATEST` 并退出。

3. **新租约 → 读取最新 → 显式比较/恢复：**原页面再次进入，对话框显示本地负责人 `E1-OFFLINE-INLINE` 与最新共享草稿负责人 `SECOND-PAGE-LATEST`（修订 2）。选择“恢复到本地输入，稍后手动保存”后，页面显示 `本地输入待保存`，本地值仍在。没有通过恢复动作提交任务写入。恢复界面截图曾在本次聊天中实际显示；未将该图片伪造为仓库截图文件。最终界面改为字段比较表，后续第 7 项实际读取了该表。

4. **校验失败 + 真实 Escape：**抽屉任务名称清空，焦点在名称输入中，按 Escape：

   ```json
   {"value":"","focused":true,"start":0,"end":0,"drawer":true,"status":"保存失败 · 输入已保留"}
   ```

5. **HTTP 400 + 真实 Escape：**抽屉名称 `E1-DRAWER-400`，按 Escape，保存返回注入的 400：

   ```json
   {"value":"E1-DRAWER-400","focused":true,"start":13,"end":13,"drawer":true,"status":"保存失败 · 输入已保留"}
   ```

6. **保存未决 + 重复 Escape → 成功关闭：**代理延迟任务响应 3 秒；抽屉名称 `E1-ESCAPE-PENDING`，连续按两次 Escape。未决时：

   ```json
   {"focused":true,"readonly":true,"selection":[17,17],"value":"E1-ESCAPE-PENDING","drawer":true,"status":"正在保存…"}
   ```

   完成后：`drawerCount=0`；状态 `共享草稿已保存 · 01:42:16`；任务按钮名已更新为 `E1-ESCAPE-PENDING`。一次写入及重复关闭阻止另由控制器回归精确断言。

7. **409 失租 → 抽屉保留 → 刷新 → 重入 → 暂不处理/放弃：**备注 `E1-STALE-LEASE-DRAWER` 按 Escape，注入 409 后：

   ```json
   {"disabled":false,"focused":true,"readonly":true,"selection":[21,21],"value":"E1-STALE-LEASE-DRAWER","drawer":true}
   ```

   刷新后同一稳定账号仍能看到该备注及“重新进入编辑并比较”按钮。该按钮可从抽屉内操作。新比较表实际内容：

   ```text
   已取得新的编辑占用并读取最新共享草稿（修订 4）
   字段     本地未提交输入          最新共享草稿
   备注     E1-STALE-LEASE-DRAWER  Isolated capacity fixture
   ```

   “暂不处理”后值仍在；再次进入并明确选择“放弃本地输入，使用最新数据”后，抽屉数量 0，显示共享草稿已保存。

## 未执行完毕及边界

- 最终跨账号 Cookie 切换的完整浏览器路径尚未通过：生成 `OLD-ACCOUNT-PRIVATE` 输入的那次工具调用因用量限制未能完成自动审批审查，**操作没有执行**；用户要求继续后，本地浏览器工具返回 `Local browser use is disabled in Work settings`。没有切换到其他控制途径绕过。稳定 UID/项目隔离、账号改变后隐藏旧输入及服务器 actor fencing 已有独立控制器/HTTP 测试，不能替代该浏览器场景。
- 最终 `requireSave()` 修正（恢复后再次采集同值仍为 dirty）有回归，但发生在浏览器不可用后，须补一次完整“刷新→恢复→显式保存→重读”浏览器验收。
- 修复后 1000 项首次 + 30 热样本浏览器性能对照未采集。优化前样本见 `browser-baseline.json`，不把旧样本当成修复后数字。
- 浏览器撤权、历史切换和路由失败的完整交互矩阵未逐项手工执行；控制器、真实 HTTP 及原有中途撤权测试已覆盖对应契约。发布前补齐。
- 因这些待验收项，E1 **不标记完整关闭**。
