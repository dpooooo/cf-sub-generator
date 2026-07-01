# 固定订阅生成器

这是一个部署在 VPS 上的 Cloudflare 优选 IP 订阅生成器。它保存自建节点配置，并在客户端请求订阅时实时从优选 IP 源获取最新 IP，生成固定链接的订阅内容。

## 项目结构

```text
cf-sub-generator/
├─ server.js
├─ src/
│  └─ core.js
├─ public/
│  ├─ index.html
│  ├─ app.js
│  └─ styles.css
├─ data/
│  └─ profiles.json
├─ .env.example
├─ .env
└─ package.json
```

## 订阅链接

默认 profile 是 `default`，固定订阅入口如下：

```text
/sub/default?target=auto
/sub/default?target=v2rayn
/sub/default?target=clash
/sub/default?target=shadowrocket
/sub/default?target=surge
```

`auto`、`v2rayn`、`shadowrocket` 当前输出通用 Base64 节点订阅；`clash` 输出 YAML；`surge` 输出 Surge Profile。

VLESS、Trojan 和 VMess 节点在替换优选 IP 时会保留原始传输参数。XHTTP 的 `mode`、`extra` 以及其他扩展查询参数会原样写入通用订阅，避免重新生成后丢失 XHTTP 配置。

## 多订阅配置

管理页面支持新建、切换、重命名和删除 Profile。每个 Profile 独立保存自建节点、优选 IP 来源、优选 IP 数量和节点名称前缀，并生成自己的五类固定订阅链接。

```text
/sub/default?target=auto
/sub/server2?target=auto
```

- `default` 始终保留且不能删除，已有 `/sub/default` 订阅地址不受影响。
- Profile ID 是固定订阅地址的一部分，创建后保持不变。
- 重命名只改变页面显示名称，不会改变订阅地址。
- 删除非默认 Profile 后，该 Profile 对应的订阅地址会失效。

## 优选 IP 选取逻辑

自动模式下，订阅生成器不会简单使用源列表前 N 个 IP，而是按线路均衡选取：

- 过滤 IPv6，只使用 IPv4。
- 按电信、联通、移动分组。
- 如果源数据提供综合线路或综合平均值，也加入综合分组。
- 每个分组内部按质量排序，丢包越低越优先，延迟越低越优先。
- 按分组轮询取数，让最终数量尽可能平均。
- 输出节点会按线路集中排列，节点名称只追加线路名，不追加延迟和丢包信息。

例如设置取 12 个 IP，且四个分组都有数据时，会尽量选出：

```text
电信 3 个 / 联通 3 个 / 移动 3 个 / 综合 3 个
```

## 本地运行

```bash
npm install
cp .env.example .env
npm start
```

默认访问：

```text
http://127.0.0.1:5176/
```

## 配置项

`.env` 示例：

```env
HOST=127.0.0.1
PORT=5176
IP_SOURCE_BASE=http://127.0.0.1:5173
DATA_DIR=./data
SITE_USERNAME=admin
SITE_PASSWORD=
ADMIN_TOKEN=
SUB_ACCESS_TOKEN=
```

说明：

- `HOST`：监听地址。宝塔反向代理时建议使用 `127.0.0.1`。
- `PORT`：订阅生成器端口，默认 `5176`。
- `IP_SOURCE_BASE`：优选 IP 源服务地址，例如同机部署时为 `http://127.0.0.1:5173`。
- `DATA_DIR`：配置存储目录，默认 `./data`。
- `SITE_USERNAME`：网页访问用户名，默认 `admin`。
- `SITE_PASSWORD`：网页访问密码。设置后，直接打开生成器网页会出现浏览器密码框；不会影响客户端拉取订阅。
- `ADMIN_TOKEN`：管理接口访问令牌。强烈建议设置，用于保护自建节点配置。
- `SUB_ACCESS_TOKEN`：可选访问令牌。留空表示订阅链接无需 token。

## 宝塔面板部署

以下假设两个服务都部署在同一台 VPS：

- 优选 IP 源服务端口：`5173`
- 订阅生成器端口：`5176`

### 1. 安装 Node.js

在宝塔面板安装：

```text
软件商店 -> Node.js 版本管理器
```

建议安装 Node.js 18 或更高版本。

### 2. 从 GitHub 获取项目

在宝塔终端或 SSH 中执行：

```bash
cd /www/wwwroot
git clone https://github.com/dpooooo/cf-sub-generator.git
cd cf-sub-generator
```

项目目录为：

```text
/www/wwwroot/cf-sub-generator
```

目录里应包含：

```text
server.js
src/
public/
data/
package.json
.env.example
```

以后更新代码时，在项目目录执行：

```bash
git pull
```

### 3. 创建 .env

在项目目录复制一份配置：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
HOST=127.0.0.1
PORT=5176
IP_SOURCE_BASE=http://127.0.0.1:5173
DATA_DIR=./data
SITE_USERNAME=admin
SITE_PASSWORD=换成高强度密码
ADMIN_TOKEN=换成一串随机字符
SUB_ACCESS_TOKEN=
```

如果优选 IP 源服务部署在别的域名或端口，把 `IP_SOURCE_BASE` 改成对应地址。
`ADMIN_TOKEN` 设置后，页面里的“管理 Token”需要填写同一串令牌，才能读取、保存和预览配置。

### 4. 安装依赖

当前项目无第三方依赖，但仍可执行：

```bash
npm install
```

### 5. 用宝塔 Node 项目启动

宝塔面板进入：

```text
网站 -> Node项目 -> 添加 Node 项目
```

推荐配置：

```text
项目目录：/www/wwwroot/cf-sub-generator
启动文件：server.js
项目端口：5176
Node 版本：18+
包管理器：npm
启动命令：npm start
```

启动后先确认本机端口可用：

```bash
curl -H "x-admin-token: 你的ADMIN_TOKEN" http://127.0.0.1:5176/api/profile/default
```

返回 `ok: true` 即表示服务正常。

### 6. 配置反向代理

在宝塔添加网站，例如：

```text
sub.example.com
```

然后设置反向代理：

```text
目标 URL：http://127.0.0.1:5176
发送域名：$host
```

配置 SSL 后，访问：

```text
https://sub.example.com/
```

### 7. 配置订阅

打开页面后：

1. 粘贴自建节点。
2. 如果设置了 `ADMIN_TOKEN`，在“管理 Token”中填入令牌。
3. 选择优选 IP 源。
4. 设置自动取前 N 个 IP。
5. 点击“生成订阅链接”。
6. 复制对应客户端订阅链接。

## 常见问题

### 如何保护管理页面和节点配置

设置 `.env`：

```env
ADMIN_TOKEN=换成一串随机字符
```

设置后，以下管理接口都需要携带 `x-admin-token` 请求头：

```text
/api/profile/default
/api/preview/default
/api/preferred-ips
```

浏览器页面中填写“管理 Token”即可。不要把 `ADMIN_TOKEN` 提交到 GitHub，项目已经通过 `.gitignore` 排除了 `.env`。

### 页面能打开，但预览失败

先检查优选 IP 源服务是否正常：

```bash
curl "http://127.0.0.1:5173/api/cloudflare?source=vps789-list"
```

如果没有返回数据，先修复优选 IP 源服务或调整 `.env` 里的 `IP_SOURCE_BASE`。

### 订阅链接固定吗

固定。配置保存在 `data/profiles.json`，链接始终是：

```text
https://你的域名/sub/default?target=clash
```

客户端每次刷新订阅时，服务端会重新读取最新优选 IP 并生成内容。

### 如何限制别人访问订阅

设置 `.env`：

```env
SUB_ACCESS_TOKEN=换成一串随机字符
```

订阅链接需要追加：

```text
?target=clash&token=换成一串随机字符
```
