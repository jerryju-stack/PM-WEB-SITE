# E-B 实施前登记

继承 E-A：五并发文件请求下心跳 P95 <1000 ms、无 30 秒租约失效；普通首页接口 P95 <500 ms。至少一次冷启动及 30 次有效热轮次。历史查询及浏览器绘制超预算继续归 E-C/E4，不能用文件 worker 修复的测量替代它们。

起始资源配置：2 worker、8 等待任务；等待载荷合计 64 MiB；单任务序列化输入/结果各 32 MiB；上传原文件 8 MiB（已有 Excel 解压总量 40 MiB）；总期限 10 秒，含排队和启动；每 worker old space 256 MiB、young space 16 MiB、stack 4 MiB。HTTP 文件请求入口含读取请求体在内最多 worker+queue 个请求。取消/超时/故障后须等待旧 worker 真正退出再补位，不允许短暂无限创建。

V8 resourceLimits 不限制 ArrayBuffer/native RSS，不能将 256 MiB 写成进程硬内存上限；同时使用输入/解压/结果字节限制及固定活跃数，并测量进程 RSS/worker heap。保留数据库/普通接口自身的内存成本，不宣称解决 E3 历史快照读放大。

可调配置将限制在 workers 1–4、queue 0–16、timeout 100–20000 ms；默认不变。验收后不倒改预算。若默认容量无法达标，先记录原因及新配置，再采集另一组结果。
