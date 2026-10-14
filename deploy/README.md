# Buzz Web 部署

[English](README.en.md) | [简体中文](README.md)

Buzz Web 是连接现有 Buzz Relay 的静态单页客户端。Web 容器与 Relay 完全隔离，不会修改 Relay 进程、网络或数据卷。Compose 默认只把 Web 绑定到 `127.0.0.1:3001`。

## 路由结构

下面是一种同域名部署示例，入口代理按路径把 `/app/*` 转发到 Web，其余请求继续交给 Relay：

| 层级 | Host | Path | 后端 |
| --- | --- | --- | --- |
| ALB | `buzz.example.com` | 全部 | `10.0.0.10:3000` |
| edge | 原样保留 | `/app`、`/app/*` | `10.0.0.10:3001` |
| edge | 原样保留 | `/app/api/agent-control/*` | 可选 Agent Control（宿主机回环地址） |
| edge | 原样保留 | `/pair` | pairing sidecar |
| edge | 原样保留 | 其他路径 | Relay 容器 |

WebSocket、`/api/*`、`/git/*`、`/upload` 和 `/media/*` 仍由 Relay 处理。`deploy/Caddyfile.edge` 是通用示例；在 Relay edge 容器中设置 `BUZZ_WEB_UPSTREAM` 为 Web 可达地址。入口代理必须保留原始 `Host` 并支持 WebSocket `Upgrade`。

### 可选：Agent Control

Agent Control 不在 `compose.yml` 中：它驱动 **rootless** Docker 守护进程，绝不能使用系统
`/var/run/docker.sock`（服务会拒绝），也不能放进挂载了 Docker socket 的容器。请在宿主机上以
rootless Docker 用户运行（例如带 `NoNewPrivileges=true` 的 systemd user unit），监听
`127.0.0.1:8095`，并配置：

- `DOCKER_HOST=unix:///run/user/<uid>/docker.sock`（rootless 守护进程）；`BUZZ_BIN_DIR` 中放置为
  Ubuntu 24.04 glibc 构建的 `buzz`、`buzz-acp`、`buzz-agent`、`buzz-dev-mcp`；
- `GRANTS_FILE`（owner → 社区 Relay URL → 权限/工作区；修改即时生效，撤销会结束正在运行的会话）、
  `STATE_DIR` 与 `DATA_ROOT` 放在私有存储；
- `PUBLIC_BASE_URL=https://buzz.example.com/app/api/agent-control`，`ALLOWED_ORIGINS` 设为 Web
  源，`TRUSTED_PROXY_IPS` 设为 edge 代理；
- 模型凭据只放在该服务自己的环境（`AGENT_LLM_*`）。

TLS 在负载均衡/edge 终止，不要直接暴露监听端口。工作负载容器只获得自己的数据目录和只读 Buzz
二进制，没有 Docker socket、宿主机网络或发布端口。然后在 `config.json` 中设置
`"agentControlUrl": "https://buzz.example.com/app/api/agent-control"`。完整说明见
[agent-control/README.md](../agent-control/README.md)。

## 启动

在项目根目录执行：

```bash
export BUZZ_WEB_BIND_ADDRESS=10.0.0.10
export BUZZ_WEB_PORT=3001
docker compose -f deploy/compose.yml config
docker compose -f deploy/compose.yml build --pull
docker compose -f deploy/compose.yml up -d
docker compose -f deploy/compose.yml ps
```

`deploy/config.json` 是 Relay 部署对所有 Web 客户端发布的公开运行时配置。必须把示例
`relayUrl` 替换为部署实际使用的 `ws://` 或 `wss://` 地址，空值会被拒绝；不得写入
`nsec`、Relay API token、owner 私钥或其他密钥。`features.projects` 和
`features.forum` 是 Web 功能开放策略，客户端设置中不提供覆盖入口。即使配置滞后，
Relay 中已存在 NIP-34 Repo 或 Forum Channel 时，对应入口也会保持可见。macOS 客户端
的 Experiments 开关仅存储在该设备的 `localStorage`，不会发布到 Relay，因此不能作为
Web 的跨设备状态来源。修改文件后需要确保文件级 bind mount 已刷新；最稳妥的方式是
仅重建 Web 容器：

```bash
docker compose -f deploy/compose.yml up -d --no-deps --force-recreate web
```

## 验证

在 Relay 主机上验证两个服务互不影响：

```bash
curl --fail --show-error http://10.0.0.10:3001/app/healthz
curl --fail --show-error http://10.0.0.10:3000/_liveness
```

ALB 路由生效后验证：

```bash
curl --fail --show-error https://buzz.example.com/app/healthz
curl --fail --show-error https://buzz.example.com/_liveness
```

浏览器入口为 `https://buzz.example.com/app/`。首次使用可通过 NIP-07 扩展登录，或在浏览器中导入 `nsec`。私钥会用用户密码经 PBKDF2 派生的 AES-GCM 密钥加密后写入 IndexedDB；解锁期间私钥目前仍存在页面主线程内存中，因此生产环境优先推荐 NIP-07 硬件或扩展签名。

## 回滚与升级

回滚时先恢复 edge 的 `Caddyfile.edge.bak-*` 并热重载，再停止 Web Compose 栈；Relay 数据不受影响。升级 Web 客户端时重新构建并启动：

```bash
docker compose -f deploy/compose.yml build --pull
docker compose -f deploy/compose.yml up -d
```

浏览器 Service Worker 只缓存带内容哈希的 `/app/assets/*`，不会缓存 HTML、`config.json`、消息、Prompt 或 Relay API 响应。
