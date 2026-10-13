# Buzz Agent Control

Agent Control is an optional companion for Buzz Web. It runs **contained** workloads for
authorized browser users:

- **Managed agents**: one rootless-Docker container per agent running `buzz-acp` + `buzz-agent` +
  `buzz-dev-mcp` against the community Relay. The agent key is generated and kept server-side.
- **Remote workspaces**: one container per (owner, community, workspace) with a PTY terminal,
  confined file operations and the `buzz-dev-mcp` tool server.

The legacy `POST /start` systemd endpoint was removed; `/v1/agents` replaces it.

## Security model

- Every `/v1` request is NIP-98 signed: kind 27235, exact `u` (full URL **including the query**),
  `method`, `payload` = sha256 of the body (empty body included), a `nonce`, |Δt| ≤ 60 s. Event
  ids are remembered for replay rejection (`409 replayed`).
- Every request names its community with `?relay=<relay url>`; resources are bound to
  owner + community and invisible (`404`) to anyone else.
- Authority comes from the operator **grants file** (below), reloaded live. Removing a grant or
  capability terminates live terminals and MCP sessions, stops the owner's agents and makes
  further calls fail with `403 revoked`; never-granted identities get `403 forbidden`. An invalid
  grants file revokes everything (fail closed).
- Terminal WebSockets are authorized by single-use tickets (≤ 30 s) bound to owner, community and
  workspace; reconnect needs a new ticket plus `?session=` within the reconnect window (60 s),
  otherwise the whole process session is killed inside the container.
- File paths are validated on the host (`..`, absolute, `~`, control characters → `400
  path_escape`) and resolved again **inside the container** by `runtime/buzz-ws-fs`, so symlinks
  pointing outside `/workspace` are rejected too.
- Containers: non-root (uid 1000), read-only root filesystem, `CapDrop: ALL`,
  `no-new-privileges`, default seccomp, memory/pids/CPU limits, bridge network (egress only, no
  host network, no published ports, no Docker socket). The only host mounts are the workspace's
  own data directory (`/workspace`) and the Buzz binaries (read-only). Agents additionally get a
  read-only directory with unix sockets that forward to *loopback-only* upstreams (the Relay and
  the configured LLM endpoint) because rootless Docker disables host loopback.
- Agent logs are redacted (nsec, secret hex, auth signature, LLM key). Secrets live in
  `STATE_DIR/secrets/<pubkey>.json` (0600) and are never returned.

## API

All responses are JSON; errors are `{"error":{"code","message"}}`.

| Route | Result |
| --- | --- |
| `GET /v1/grant` | `{grant:{capabilities,workspaces,maxWorkspaces,maxAgents}}` |
| `GET /v1/agents` / `POST /v1/agents {name,config}` | list / `201 {pubkey, authChallenge}` |
| `POST /v1/agents/{pk}/authorize {authTag}` | verifies the NIP-OA tag, publishes kind 0 + 10100 |
| `GET/PATCH/DELETE /v1/agents/{pk}` | `{agent}` / `{agent}` / `{deleted:true}` |
| `POST /v1/agents/{pk}/start\|stop\|restart` | `{agent}` with the status observed in Docker |
| `GET /v1/agents/{pk}/logs?tail=200` | `{lines:[{ts,stream,text}]}` |
| `GET/POST /v1/workspaces`, `DELETE /v1/workspaces/{id}` | list / `201 {workspace}` / delete |
| `POST /v1/workspaces/{id}/terminal-tickets` | `201 {ticket, expiresAt}` |
| `WS /v1/workspaces/{id}/terminal?ticket=&cols=&rows=[&session=]` | PTY frames (below) |
| `GET …/files?path=` · `GET/PUT/DELETE …/file?path=` | list · download/upload(≤ 25 MB)/delete |
| `GET …/mcp/tools` · `POST …/mcp/calls {callId,name,arguments}` · `POST …/mcp/calls/{id}/cancel` | MCP |

Terminal frames: client → `{"type":"input","data"}`, `{"type":"resize","cols","rows"}`,
`{"type":"close"}`; server → `{"type":"session","id","reconnectSeconds"}`,
`{"type":"output","data"}`, `{"type":"exit","code","reason?"}` (`reason`: closed, detached,
expired, revoked, deleted).

## Configuration

```dotenv
LISTEN_HOST=127.0.0.1
LISTEN_PORT=8095
PUBLIC_BASE_URL=https://buzz.example.com/app/api/agent-control   # exact prefix the browser signs
ALLOWED_ORIGINS=https://buzz.example.com                        # exact CORS/WebSocket origins
TRUSTED_PROXY_IPS=127.0.0.1
GRANTS_FILE=/etc/buzz-agent-control/grants.json
STATE_DIR=/var/lib/buzz-agent-control/state
DATA_ROOT=/var/lib/buzz-agent-control/data
DOCKER_HOST=unix:///run/user/<uid>/docker.sock                 # rootless daemon; system socket refused
BUZZ_BIN_DIR=/opt/buzz/bin                                      # buzz, buzz-acp, buzz-agent, buzz-dev-mcp
CONTAINER_MEMORY_MB=512
CONTAINER_PIDS=256
CONTAINER_MILLICPUS=1000
AGENT_LLM_PROVIDER=openai
AGENT_LLM_API=chat
AGENT_LLM_BASE_URL=https://api.openai.com/v1
AGENT_LLM_API_KEY=<provider key>
AGENT_DEFAULT_MODEL=<model>
```

The Buzz binaries must be built for a glibc compatible with the runtime image (Ubuntu 24.04).
On start the service builds `runtime/Dockerfile` into the daemon (tag = content hash).

Grants file:

```json
{
  "version": 1,
  "owners": {
    "<owner pubkey hex>": {
      "wss://relay.example.com": {
        "capabilities": ["agents", "terminal", "files", "mcp"],
        "workspaces": ["*"],
        "maxWorkspaces": 3,
        "maxAgents": 4
      }
    }
  }
}
```

Web runtime configuration: `{"agentControlUrl": "https://buzz.example.com/app/api/agent-control"}`
(`http://127.0.0.1`/`localhost` allowed for local development). The reverse proxy must forward
`/v1/*` (including WebSocket upgrades) and preserve the path and query byte-for-byte.

## Run and test

```bash
npm ci
npm test          # node --test: NIP-98, replay, grants/live reload, paths, tickets, config, logs
npm start
```

`npm run stub-llm` starts a **synthetic**, deterministic OpenAI-compatible endpoint on
`127.0.0.1:47411` for live checks only: it answers a mention by calling the shell tool with
`buzz messages send … --content "[synthetic stub LLM] automated reply"`. Never use it as a model.

The live browser acceptance lives in `web/tests/e2e/live-remote.spec.ts`
(`web/playwright.live-remote.config.ts`; env `BUZZ_LIVE_BASE_URL`, `BUZZ_LIVE_RELAY_URL`,
`BUZZ_LIVE_AGENT_CONTROL_URL`, `BUZZ_LIVE_REMOTE_GRANTS_FILE`, `DOCKER_HOST`, identities).

## Operational notes

- Replay tracking is in-memory; run one replica or add a shared TTL store.
- Terminal sessions and MCP processes do not survive a service restart; containers, files and
  agents do (agents' forwarding sockets are recreated on start).
- Agent online/offline comes from Relay presence; `running` means Docker reports the container up.
