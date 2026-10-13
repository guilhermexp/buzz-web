# P0 真实 Relay 验收

[English](p0-relay-acceptance.md) | [简体中文](p0-relay-acceptance.zh-CN.md)

P0 已在 Web 客户端实现，但只有以下工作流在已授权的真实 Relay 上通过后，才能认定达到
发布验收标准。Demo 模式 E2E 仍用于回归测试，但不能替代这一门槛。

## 安全边界

使用两个已经加入社区的专用测试身份：

- 管理员身份必须具有 owner 或 admin 权限，且不能使用运维人员的主身份。
- 成员身份必须是另一个普通测试成员。
- 两个 `nsec` 只允许由本机密码管理器或 CI Secret Store 注入，明文不能出现在 Shell
  历史、已提交文件、URL、测试报告、截图或 Trace 中。

Live 测试会关闭截图、Trace、视频、重试和并行 Worker。测试会创建一个以 `web-p0-` 开头
且名称唯一的私有频道，在频道内执行真实 Relay 写入，移除测试成员，并在清理阶段归档频道。
失败的测试可能留下带此前缀的测试频道；应通过 Web 或 Desktop 的正常操作检查并归档，禁止
直接修改 Relay 存储进行清理。

## 自动化执行

先通过所选 Secret Manager 把两个专用身份注入为已有环境变量，然后执行：

```bash
cd web
BUZZ_LIVE_BASE_URL=https://buzz.example.com/app/ \
BUZZ_LIVE_ADMIN_NSEC="$TEST_ADMIN_NSEC" \
BUZZ_LIVE_MEMBER_NSEC="$TEST_MEMBER_NSEC" \
npm run test:e2e:live-p0
```

自动化场景验证：

- 两个已授权身份的 NIP-42 连接。
- owner/admin 创建频道，以及私有频道在加入前、加入后和移除后的可见性。
- guest、admin、member 角色切换和带确认的成员移除。
- 收藏和静音状态能在独立浏览器上下文中从 Relay 恢复。
- 草稿按 Relay、身份和频道隔离并在刷新后恢复。
- 频道未读实时出现、打开频道后清除，并在刷新后保持已读。
- 消息发送、Reaction、线程回复、编辑、删除，以及线程关联保持完整（已删除的消息保留回复，但不再提供 Reaction）。
- 使用与正常客户端相同的授权界面操作归档测试频道。

## 功能真实 Relay 套件

各对齐功能有独立的真实 Relay 套件。它们使用相同的专用身份（`BUZZ_LIVE_ADMIN_NSEC`、
`BUZZ_LIVE_MEMBER_NSEC`），用 `BUZZ_LIVE_BASE_URL` 指定被测 Web 构建，用 `BUZZ_LIVE_RELAY_URL`
进行直接协议检查。在 `web/` 下运行 `npx playwright test --config=<config>`。

| 配置 | 覆盖范围 | 额外要求 |
| --- | --- | --- |
| `playwright.live-uishell.config.ts` | 跨两个 Relay 的社区切换与隔离 | 第二个独立 Relay（`BUZZ_LIVE_RELAY_B_URL`、`BUZZ_LIVE_COMMUNITY_B_NAME`）、在其上具有 admin 权限的 `BUZZ_LIVE_SECOND_ADMIN_NSEC`，以及 `config.json` 中的社区预设 |
| `playwright.live-composer.config.ts` | 格式、提及、表情、附件、草稿 | — |
| `playwright.live-gif.config.ts` | 由 Relay 代理的 KLIPY GIF 搜索：服务失败映射（en/zh-CN，不发送任何内容），以及搜索 → 分享上报 → 发送 → 渲染的成功路径 | 声明 `buzz-gif` 的 Relay；见 [GIF 搜索前置条件](#gif-搜索前置条件) |
| `playwright.live-collab.config.ts` | Canvas、论坛、提醒、Pulse、导出 | — |
| `playwright.live-agents.config.ts` | 托管 Agent 生命周期、用量、记忆、目录 | Agent Control（`BUZZ_LIVE_AGENT_CONTROL_URL`）、`agents` 授权和模型端点 |
| `playwright.live-projects.config.ts` | 发布、Issue、PR、评审、合并、受保护 Ref | 测试主机需要 `git` |
| `playwright.live-workflows.config.ts` | Workflow 编辑、运行与审批 | 带审批关口的配套 Relay |
| `playwright.live-voice.config.ts` | Huddle 音频、静音、离开、撤销；语音消息 | 配套 Relay，原生协议对端需要 `ffmpeg` 和 `libopus` |
| `playwright.live-voice-controls.config.ts` | 拒绝权限、关闭收听、设备丢失、重连、Firefox | 配套 Relay |
| `playwright.live-push.config.ts` | 关闭全部应用标签页后的 Web Push、深链接、静音 | 配置了 VAPID 的 Relay、Firefox，以及可访问推送服务的网络 |
| `playwright.live-remote.config.ts` | 远程终端、文件、MCP、撤销 | 具有 `terminal`/`files`/`mcp` 授权且授权文件可写（`BUZZ_LIVE_REMOTE_GRANTS_FILE`）的 Agent Control |

功能套件会把截图和证据日志写入 Playwright 输出目录或被忽略的 `.tmp/` 目录（各 spec 顶部注明覆盖变量）。
分享前请检查：其中包含测试内容和公钥，但绝不包含私钥。

### GIF 搜索前置条件

GIF 搜索由 Relay 代理（Buzz Relay `docs/gif-search.md`）。只有当 Relay 的 NIP-11 声明 `buzz-gif` 时，
Web 选择器才会搜索；而只有 Relay 进程配置了 `BUZZ_KLIPY_API_KEY` 时才会声明。成功路径需要真实的服务结果，
在运营者提供密钥之前仍未验证；它不会被豁免，也不会被模拟。

前置条件：

1. 由 Relay 运营者通过 KLIPY 开发者计划获取、并经运营者批准的 KLIPY API 测试密钥。不得借用生产密钥或测试人员的个人账号。
2. Relay 主机可通过 HTTPS（443 端口）出站访问 `api.klipy.com`。浏览器直接从 KLIPY CDN（`*.klipy.com`）加载所选媒体，
   Web CSP 通过 `img-src https:` 允许。
3. 密钥只存在于 Relay 的环境中。它位于上游请求路径中（`https://api.klipy.com/api/v1/<key>/gifs/...`），
   因此绝不能出现在分享的 URL、Shell 历史、工单、日志、Web `config.json` 或浏览器存储中。Relay 禁用重定向，
   也从不把服务方响应体返回给客户端。

安全注入方式（不回显输入，不进入历史记录或进程列表）：

```bash
umask 077
read -rs KLIPY_KEY && printf 'BUZZ_KLIPY_API_KEY=%s\n' "$KLIPY_KEY" > <relay-secrets-dir>/klipy.env
unset KLIPY_KEY
chmod 600 <relay-secrets-dir>/klipy.env
```

把该文件载入 Relay 进程环境（systemd `EnvironmentFile=`、Compose `env_file:` 或启动脚本的 `source`），
然后重启 Relay 进程，例如 `systemctl restart <relay-unit>`；该变量只在启动时读取。配套任务启动脚本
（Relay 工作树中的 `.tmp/runtime/relay.sh`）只为 relay A 和 B 载入 `.tmp/runtime/secrets/klipy.env`；
创建文件后需停止并重新启动这两个 relay 进程。在不暴露密钥的前提下确认能力：

```bash
curl -s -H 'Accept: application/nostr+json' https://buzz.example.com/info \
  | jq '{buzz_gif: (.supported_extensions | index("buzz-gif") != null), gif}'
```

应看到 `"buzz_gif": true` 和 `{"provider": "klipy", "search": "/gifs/search", "share": "/gifs/share"}`。
然后运行成功路径：

```bash
cd web
BUZZ_LIVE_BASE_URL=https://buzz.example.com/app/ \
BUZZ_LIVE_RELAY_URL=wss://buzz.example.com \
BUZZ_LIVE_ADMIN_NSEC="$TEST_ADMIN_NSEC" \
BUZZ_LIVE_MEMBER_NSEC="$TEST_MEMBER_NSEC" \
BUZZ_LIVE_GIF_EXPECT_RESULTS=1 \
npx playwright test --config=playwright.live-gif.config.ts --grep "selects a KLIPY"
```

它会搜索并选择一个结果（Relay 必须以 `204` 响应分享上报），然后发送该结果，并断言消息正文携带 `*.klipy.com`
URL、没有 `imeta` 标签或上传，且第二个浏览器能渲染该图片。只要 NIP-11 未声明 `buzz-gif` 或未设置
`BUZZ_LIVE_GIF_EXPECT_RESULTS=1`，该测试就会被跳过，原因以
`operator prerequisite missing: an operator-approved KLIPY test key (BUZZ_KLIPY_API_KEY)` 开头。跳过不等于通过。

服务失败测试针对一个故意配置了明显无效占位值（例如 `BUZZ_KLIPY_API_KEY=invalid-test-key-not-a-credential`）的
Relay，并设置 `BUZZ_LIVE_GIF_EXPECT_ERROR_STATUS=502`。在 2026-10-13 的运行中，KLIPY 对该占位值返回 `404`，
Relay 将其映射为 `502 GIF provider rejected the search request`，Web 显示本地化的服务失败提示，
且没有发送或上传任何内容。要移除密钥，请删除 `klipy.env` 并重启 Relay；之后 NIP-11 不再声明 `buzz-gif`，
选择器会说明 GIF 搜索不可用。

## 跨客户端人工门槛

自动化通过后，使用相同专用身份，在 Web 与当前 Buzz Desktop 版本之间核对：

1. 收藏、静音、归档和恢复状态能够双向最终一致。
2. 任一客户端读消息后，另一个客户端的频道和 Inbox 未读状态在重连后清除。
3. 私有频道在加入前不可见，加入后出现，移除后消失。
4. Relay 拒绝权限操作后，Web 不遗留看似成功的消息、角色、归档或 Profile 状态。
5. 身份备份、忘记、恢复和切换完成后，浏览器存储及下载诊断中不出现原始私钥材料。

记录日期、Web Commit、Desktop 版本、公开 Relay 地址、两个测试公钥和结果。禁止记录私钥
或可重复使用的邀请码。
