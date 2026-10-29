# 正式环境 IP 直接访问

2026-10-29 将 `/etc/nginx/conf.d/pm-web.conf` 从 IP 到域名的 301 跳转改为反向代理到 `127.0.0.1:3000`。配置源文件为 `ops/pm-web-ip.conf`，后续部署应使用此配置，保持 IP 直接访问。

- IP 入口：`http://67.230.188.116/`
- 域名入口：`https://www.l-sopp.com/`
- 保留维护标记、21 MB 请求体限制、120 秒代理读取超时及真实客户端地址传递。
- 生效方式：`nginx -t` 通过后 `systemctl reload nginx`，等待新 worker 接管请求。
- 服务器原配置备份：`/etc/nginx/conf.d/pm-web.conf.bak-20261029-143433`。
- 已验证 GET：IP 首页、IP `/api/data`、域名 HTTPS 首页均返回 200，IP 首页无 Location 跳转响应头。

本机 `.deploy/cutover.sh` 已同步改为代理配置，并将 IP 状态检查从 301 改为 200。该目录属于本地部署文件，仓库通过上述 `ops` 配置保留正式配置来源。

浏览器可能缓存此前的永久跳转；若仍跳到域名，可使用无痕窗口打开完整 HTTP 地址，或清除此 IP 的站点缓存后重试。IP 与域名的登录会话分别保存，需要分别登录。
