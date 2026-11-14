# 联想个人云 T2 内网门户

为联想个人云 T2 增加一个浏览器入口：查看设备状态、浏览和下载 NAS 文件、管理链接及 BT 下载，并接入固件自带的百度网盘和迅雷入口。非联想官方项目，针对有 SSH 管理权限的 T2 用户；不需要刷机、安装 Docker 或替换原厂 Web 服务。

| 功能 | 当前范围 |
| --- | --- |
| 设备概览 | 容量、负载、内存、巡检排程、下载统计和服务监听状态 |
| 文件和管理 | 文件浏览、搜索、最近文件、按原厂权限下载；查看分享记录、磁盘摘要、挂载、固件、应用、用户、日志、照片时间线、摄像头列表及开关机计划 |
| 链接和 BT 下载 | 添加 HTTP(S) 链接、磁力或种子；查看、暂停、继续和移除任务。移除保留文件；链接失败可重新提交，BT 可重新校验 |
| 百度网盘 | 使用原厂已绑定账号，浏览目录、提交下载和查看任务；可从门户取回个人下载目录中的文件。单文件已在 T2 验证；批量与目录下载尚未验证完整流程，会员加速未验证 |
| 迅雷 | 跳转到原厂内网页面，登录和任务管理仍由迅雷处理 |

门户还不支持普通文件上传、创建分享、媒体播放、系统设置修改或 NAS 数据备份。型号和固件版本不同可能影响原厂接口；没有把 T2 Pro 或其他型号作为已支持设备。

## 工作原理

浏览器访问 NAS 的 `9090` 查看免登录概览，点击文件或下载入口后进入 `9443` 的 HTTPS 管理区。独立 Nginx 提供静态页面和反向代理，Python 后台只监听 `127.0.0.1:19090`，使用 NAS 原厂 HTTP 接口验证用户。浏览器收到短期会话 Cookie；原厂令牌仅留在后台内存。公开版不保存账号密码，也不提供共享免登录入口。

管理接口只执行代码里列出的动作。下载中心要求原厂管理员权限：链接任务走本机 aria2，BT 任务走 qBittorrent。已完成的公共下载位于 `/sata/download/complete`；百度文件保存在原厂绑定对应的个人空间 `download/complete`。普通文件下载先检查门户会话，再交给原厂接口检查文件权限。大文件由 Nginx 传输，支持 Range 请求。门户不把原厂 RPC 直接代理给浏览器。

## 部署

只在可信内网运行。不要转发 9090、9443、19090 或下载 RPC 到公网。确认 NAS 的管理 IP 固定且端口空闲；准备工作站上的 Python 3、OpenSSL、SSH 和 tar。NAS 需要现有的 `/usr/sbin/nginx`、`/usr/bin/python`、`flock`、`/media` 持久存储以及原厂服务。下例使用文档保留地址，必须替换为你的地址和子网。以 NAS 上已有的 SSH 管理账号登录；本项目不安装或修改 SSH 权限。

1. 在仓库根目录用工作站生成配置及独立证书（不要把生成目录提交到 Git）：

   ```sh
   NAS_IP=192.0.2.10
   NAS_LAN=192.0.2.0/24
   NAS_SSH=your-admin@"$NAS_IP"
   umask 077
   python3 configure.py --nas-ip "$NAS_IP" --lan "$NAS_LAN" --out deployment
   mkdir -p deployment/tls
   openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 \
     -subj "/CN=$NAS_IP" -addext "subjectAltName=IP:$NAS_IP" \
     -keyout deployment/tls/key.pem -out deployment/tls/cert.pem
   openssl x509 -in deployment/tls/cert.pem -noout -fingerprint -sha256
   ```

2. 以下步骤假定 SSH 用户在 NAS 上具备 root 权限。先确认目标不存在；已有部署应先备份并单独迁移。只传明确列出的文件：

   ```sh
   set -e
   ssh "$NAS_SSH" 'mkdir -m 755 /media/nas-portal'
   tar -cf - server.py native.py transfers.py baidu.py startup S99z-nas-portal static |
     ssh "$NAS_SSH" 'tar -xf - -C /media/nas-portal'
   tar -C deployment -cf - nginx.conf settings.json tls |
     ssh "$NAS_SSH" 'umask 077; tar -xf - -C /media/nas-portal'
   ssh "$NAS_SSH" '
     set -e
     cd /media/nas-portal
     chown -R root:root .
     chmod 755 startup S99z-nas-portal static
     chmod 644 static/*
     chmod 600 tls/key.pem
     ./startup start
   '
   ```

3. 用工作站验证两端口，HTTPS 验证使用刚生成的公开证书：

   ```sh
   curl --noproxy '*' -fsS "http://$NAS_IP:9090/api/status"
   curl --noproxy '*' --cacert deployment/tls/cert.pem -fsS "https://$NAS_IP:9443/manage.html"
   ```

   浏览器打开 `http://NAS_IP:9090/`。在受信任设备上核对指纹后，按该设备的证书信任策略处理自签名证书。管理区输入自己的联想个人云本地账号。下载中心使用管理员账号；百度网盘先在联想客户端绑定，迅雷在原厂页面单独登录。

## 开机自启、备份和恢复

手动运行 `/media/nas-portal/startup start` 或 `stop`。如果设备固件的启动流程会执行 `/etc/init.d/S??*`，可选装 `S99z-nas-portal`。先确认同名脚本不存在；若系统分区只读，优先采用设备已有的启动机制。不要为了装门户刷机。安装后通过单独停止并重新启动门户验证；只有实际重启后才能确认整机自启。固件更新可能清除钩子，届时需重新验证。

在确认 `/etc/init.d` 可写且启动机制兼容后，用 NAS 的管理 shell 执行：

```sh
test ! -e /etc/init.d/S99z-nas-portal &&
  cp -p /media/nas-portal/S99z-nas-portal /etc/init.d/S99z-nas-portal
```

备份时保存 `/media/nas-portal` 下的源码、静态文件、生成配置及启动脚本。证书私钥单独加密备份；如果不保留旧私钥，可以重新生成证书并在客户端更新信任。不要打包 NAS 文件、云盘令牌、日志或个人账号。恢复时先停止门户，在原路径恢复文件并检查权限，运行 `startup start`，再验证状态和管理入口。

## 常见问题

- **首页 403**：核对访问地址是否与生成配置相同，以及客户端是否在允许的子网内。
- **后台 502**：查看 NAS 上 `/run/nas-portal/status.log` 和 `/run/nas-portal/error.log`，确认 Python 监听 19090，原厂 Web 服务仍可用。排错记录发布前请脱敏。
- **下载任务打不开或失败**：检查固件是否启用了对应下载服务，及 NAS 自己能否访问目标地址；浏览器能打开不代表 NAS 能下载。
- **升级或卸载**：先备份，再停止本项目的独立实例。移除可选的本项目启动钩子即可取消自启；不要删除 `/sata` 下的下载文件或原厂配置。

## 交给 AI 安装

把下面整段复制给具备终端工具的 AI 编程助手。可提前填好型号、NAS 内网 IP、可信子网和已有 SSH 别名；不确定的可以留空。不要把密码、私钥或云盘令牌贴进聊天。

```text
请帮我在联想个人云 T2 上安装并验证这个内网门户：
https://github.com/jin9xiao/lenovo-nas-portal

我的环境：
- NAS 型号和固件版本：
- NAS 内网 IPv4：
- 允许访问的局域网 CIDR：
- 已配置的 SSH 别名或用户@主机：
- 是否需要开机自启：默认否

1. 先完整阅读仓库 README 和启动脚本。用只读方式核对型号、固件、
   SSH 管理权限、NAS IP、可信子网、现有 Python/Nginx/flock、持久目录、
   9090/9443/19090 端口以及是否已有门户。缺少必要信息时再问我；
   如果没有可用的 SSH 权限，让我先用设备支持的方式准备管理访问。
2. 按 README 用实际 IP 和子网生成配置及带 IP SAN 的独立 TLS 证书。
   仅部署 README 列出的文件。私钥只通过已有的可信 SSH 连接传输，
   不要输出或提交私钥。安装到独立目录，不替换原厂服务。
   若发现旧部署，先说明备份、迁移和回滚方法，不要覆盖旧文件。
3. 验证 9090 概览、9443 管理页、未登录访问受保护接口被拒绝，
   并确认原厂页面仍可访问。HTTPS 使用本次生成的证书验证，
   不使用关闭证书校验的参数。原厂账号由我在浏览器里输入；
   如需验证下载，先用我同意的测试文件，不改动已有任务。
4. 仅在我选择开机自启且确认固件启动机制后安装启动钩子。
   不要修改 SSH 账号、刷机、格式化、开放公网端口或擅自重启 NAS。
   只验证过门户冷启动时，要明确说明整机重启尚未验证。
5. 最后给出实际访问地址、证书指纹、验证结果、未完成事项和回滚步骤。
   如果你没有终端或 SSH 工具，给我逐条可执行的命令，
   不要声称已经在我的设备上完成安装。
```
