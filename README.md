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
SUB_ACCESS_TOKEN=
```

说明：

- `HOST`：监听地址。宝塔反向代理时建议使用 `127.0.0.1`。
- `PORT`：订阅生成器端口，默认 `5176`。
- `IP_SOURCE_BASE`：优选 IP 源服务地址，例如同机部署时为 `http://127.0.0.1:5173`。
- `DATA_DIR`：配置存储目录，默认 `./data`。
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
SUB_ACCESS_TOKEN=
```

如果优选 IP 源服务部署在别的域名或端口，把 `IP_SOURCE_BASE` 改成对应地址。

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
curl http://127.0.0.1:5176/api/profile/default
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
2. 选择优选 IP 源。
3. 设置自动取前 N 个 IP。
4. 点击“生成订阅链接”。
5. 复制对应客户端订阅链接。

## 常见问题

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
