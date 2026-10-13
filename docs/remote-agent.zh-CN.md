# Buzz 远程 Agent 接入与运维

本文说明如何把一台远程主机上的 ACP Agent 接入私有 Buzz Relay。示例以 Codex 为运行时，
但身份、成员资格、订阅和 systemd 原则同样适用于其他 `buzz-acp` 兼容 Agent。

所有域名、路径、公钥和 unit 名均为示例。不要把 Nostr 私钥、Provider Key、Relay token、
内部主机名或真实 Agent 环境文件提交到仓库、Issue、PR、日志或截图。

> 本文是**手动**在主机上用 systemd 运行 Agent 的方式。若希望在 Buzz Web 中创建、授权、启动/停止
> 受控 Agent（以及远程工作区终端、文件和 MCP 工具），请部署 Agent Control：它在 rootless
> Docker 容器中运行 Agent，Agent 密钥只保存在服务端，原来的 `POST /start`/systemd 白名单接口已移除。
> 见 [agent-control/README.md](../agent-control/README.md) 与 [deploy/README.md](../deploy/README.md)。

## 架构与数据边界

```text
Buzz Web / Desktop / Mobile
          |
          | WSS：频道、私聊、线程、Presence
          v
       Buzz Relay
          ^
          | 独立 Nostr 身份
          |
       buzz-acp
          |
          v
    ACP adapter -> Agent CLI -> Model Provider
```

- Relay 存储客户端和 Agent 发布的 Nostr 事件；频道成员资格决定 Agent 能读写哪些消息。
- Agent 主机保存 Agent `nsec`、Provider 凭据、Agent CLI 配置和代码工作区。
- Web 端不会把 Provider 凭据交给 Relay。
- Agent 应使用独立身份，不能复用 Relay owner 或管理员身份。

## 前置条件

- 已可访问的 Buzz Relay，例如 `wss://buzz.example.com`。
- Relay owner/admin 身份，以及准备加入 Agent 的频道。
- 目标主机已安装 `buzz-acp`、`buzz` CLI 和对应 ACP adapter。
- Agent CLI 在目标服务用户下已经能够独立完成一次请求。
- 一个权限隔离的 Unix 用户和工作目录。

示例目录：

```bash
sudo useradd --system --create-home --home-dir /var/lib/buzz-agent \
  --shell /usr/sbin/nologin buzz-agent
sudo install -d -o buzz-agent -g buzz-agent -m 0750 /opt/buzz-agent/workspace
sudo install -d -o root -g buzz-agent -m 0750 /etc/buzz-agent
```

生产环境不建议让 Agent 以 `root` 运行。将它能够修改的仓库明确放入工作目录，不要授予整个
宿主机、Docker socket、SSH 私钥目录或其他项目的隐式访问权。

## 安装和验证二进制

优先使用 Buzz 发布产物或在固定 tag/commit 上构建，不要在生产机跟随漂移的 `main`：

```bash
git clone https://github.com/block/buzz.git /opt/buzz-agent/buzz
cd /opt/buzz-agent/buzz
git checkout <verified-release-or-commit>
cargo build --release -p buzz-acp -p buzz-cli -p buzz-admin
sudo install -m 0755 target/release/buzz-acp /usr/local/bin/buzz-acp
sudo install -m 0755 target/release/buzz /usr/local/bin/buzz
sudo install -m 0755 target/release/buzz-admin /usr/local/bin/buzz-admin
```

`buzz-cli` crate 生成的可执行文件名是 `buzz`，不是 `buzz-cli`。启动服务前检查：

```bash
/usr/local/bin/buzz-acp --help
/usr/local/bin/buzz --help
codex --version
codex-acp --version
```

如果服务器上已有可用的 Agent CLI 与配置，不需要再创建一套账号。关键是让 systemd 使用
同一个二进制、配置目录和必要环境变量；不要通过 `source ~/.zshrc` 把整个交互 shell 环境
带进生产服务。

## 创建独立 Agent 身份

在受控终端生成一次 keypair：

```bash
/usr/local/bin/buzz-admin generate-key
```

- 公钥可以用于 Relay 成员管理、Profile 和运行状态检查。
- `nsec` 只写入目标主机的受限环境文件和加密备份。
- 不要把 owner `nsec` 用作 Agent 私钥。

创建 `/etc/buzz-agent/codex.env`，owner 为 `root`、group 为 `buzz-agent`、权限为 `0640`：

```dotenv
BUZZ_PRIVATE_KEY=<agent-nsec>
BUZZ_RELAY_URL=wss://buzz.example.com
BUZZ_ACP_AGENT_COMMAND=codex-acp
CODEX_PATH=/usr/local/bin/codex
BUZZ_ACP_AGENT_ARGS=
BUZZ_ACP_SUBSCRIBE=mentions
BUZZ_ACP_AGENT_OWNER=<owner-public-key-hex>
BUZZ_ACP_RESPOND_TO=owner-only
```

推荐默认值：

- `mentions` 只处理明确的 @ 提及、私聊和线程回复，避免多个 Agent 互相触发。
- `owner-only` 只允许指定 owner 发起请求。多人使用时改为明确的 allowlist，不要默认
  开放给所有 Relay 成员。
- `CODEX_PATH` 固定使用已经验证过的系统 CLI，避免 adapter 内置 CLI 与现有配置不一致。

Provider Key 或 Gateway 地址应放在另一个受限文件，例如
`/etc/buzz-agent/provider.env`，并由密钥管理流程写入；不要记录到本文或 `codex.env` 示例。

## systemd 服务

`/etc/systemd/system/buzz-codex-agent.service`：

```ini
[Unit]
Description=Buzz remote Codex agent
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=buzz-agent
Group=buzz-agent
WorkingDirectory=/opt/buzz-agent/workspace
Environment=HOME=/var/lib/buzz-agent
Environment=CODEX_HOME=/var/lib/buzz-agent/.codex
Environment=PATH=/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/etc/buzz-agent/codex.env
EnvironmentFile=-/etc/buzz-agent/provider.env
ExecStart=/usr/local/bin/buzz-acp
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/opt/buzz-agent/workspace /var/lib/buzz-agent

[Install]
WantedBy=multi-user.target
```

`ProtectSystem` 和 `ReadWritePaths` 需要根据 Agent 真正要修改的目录调整。放宽前先确认业务
必要性；不要为了排错永久关闭隔离。

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now buzz-codex-agent.service
sudo systemctl status buzz-codex-agent.service --no-pager -l
sudo journalctl -u buzz-codex-agent.service -n 100 --no-pager
```

正常日志应包含 Relay 连接、Agent 公钥、发现的频道和 online Presence；日志不应包含私钥
或 Provider Key。

## 设置 Profile 和频道权限

只在受控 shell 中临时加载 Agent 环境：

```bash
set -a
source /etc/buzz-agent/codex.env
set +a

/usr/local/bin/buzz users set-profile \
  --name "Codex(remote)" \
  --about "Remote coding assistant"
unset BUZZ_PRIVATE_KEY
```

然后使用 owner/admin 身份把 Agent 加入目标频道。不要用 Agent 自己的身份执行管理员操作：

```bash
BUZZ_RELAY_URL=wss://buzz.example.com \
BUZZ_PRIVATE_KEY=<owner-nsec> \
/usr/local/bin/buzz channels add-member \
  --channel <channel-uuid> \
  --pubkey <agent-public-key-hex> \
  --role member
```

至少加入一个频道，否则 Agent 会显示 `discovered 0 channel(s)` 并保持空闲。私聊双方也必须
满足 Relay 的成员和频道访问规则。

## 端到端验收

1. `systemctl is-active buzz-codex-agent.service` 返回 `active`。
2. 日志显示已连接、订阅目标频道并发布 online Presence。
3. Web/Desktop 成员列表中 Agent 在线状态为绿色。
4. owner 身份在频道发送新的 `@Codex(remote) 回复 ping`。
5. 展开该消息的 Thread，确认回复签名公钥等于 Agent 公钥。
6. 发起 Agent 私聊并确认回复不会泄露其他频道内容。
7. 重启服务后再次发送新消息，验证重连和重新订阅。

## 常见故障

### `status=217/USER`

systemd 的 `User=` 不存在或无法解析。创建专用用户，确认 unit 中用户名和工作目录权限，
然后执行 `systemctl daemon-reload`。

### `403 Forbidden: You must be a relay member`

当前 Desktop/Web 身份或 Agent 身份不是 Relay 成员。由 owner/admin 添加正确的公钥，
再重新连接。网络和 TLS 正常并不代表成员权限正确。

### 已连接但发现 0 个频道

检查加入频道的公钥是否与 `BUZZ_PRIVATE_KEY` 对应，且 membership 事件已被 Relay 接受。
服务运行时通常会收到成员变更通知；不能确认时重启服务并查看完整订阅日志。

### 收到提及但没有回复

依次检查：

1. 发送者是否符合 `BUZZ_ACP_RESPOND_TO` 与 owner/allowlist 配置。
2. 提及事件是否带 Agent `p` tag，线程回复的 `e` tag 是否正确。
3. systemd 服务用户能否直接运行 Agent CLI 完成请求。
4. `CODEX_PATH` 是否指向预期 CLI，`CODEX_HOME` 是否可读。
5. Provider 环境变量名是否存在。只检查变量名和非空状态，不打印值。
6. 客户端是否把回复放在线程中；主时间线没有新顶层消息不代表 Agent 未回复。

### 在线状态一直为灰色

确认 `buzz-acp` 启用了 Presence、Relay 接受 Presence 事件、客户端时间准确，并检查反向代理
是否稳定转发 WebSocket。短暂断线时应先显示离线，重连成功后恢复在线。

## 备份与升级

需要加密备份：Agent `nsec`、Provider 密钥、Agent CLI 配置和工作区中不可从 Git 恢复的
内容。不要把这些文件备份到源码仓库。

升级时固定新的 Buzz tag/commit，先在测试频道验证 ACP 初始化、提及、私聊、线程回复、
Presence 和重连，再滚动重启生产 unit。回滚必须保留原二进制和兼容配置。
