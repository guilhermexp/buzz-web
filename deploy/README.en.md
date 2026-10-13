# Buzz Web Deployment

[English](README.en.md) | [简体中文](README.md)

Buzz Web is a static single-page client for an existing Buzz Relay. Its container is isolated from
the Relay and does not modify Relay processes, networks, databases, or volumes. Compose binds the Web
container to `127.0.0.1:3001` by default.

## Routing

A same-origin deployment can route `/app/*` to the Web container and leave all other traffic on the
Relay:

| Layer | Host | Path | Backend |
| --- | --- | --- | --- |
| External load balancer | `buzz.example.com` | all | private edge proxy |
| Edge proxy | original Host | `/app`, `/app/*` | Web container port `3001` |
| Edge proxy | original Host | `/app/api/agent-control/*` | optional Agent Control on host loopback |
| Edge proxy | original Host | `/pair` | optional pairing sidecar |
| Edge proxy | original Host | all other paths | Buzz Relay |

WebSocket traffic, `/api/*`, `/git/*`, `/upload`, and `/media/*` continue to the Relay. The example
[`Caddyfile.edge`](Caddyfile.edge) preserves the original Host and supports WebSocket upgrades.

### Optional Agent Control

Agent Control is not part of `compose.yml`: it drives a **rootless** Docker daemon and must never
be given the system `/var/run/docker.sock` (it refuses it) or be run inside a container with a
Docker socket. Run it on the host as the rootless-Docker user (for example a systemd *user* unit
with `NoNewPrivileges=true`), listening on `127.0.0.1:8095`, with:

- `DOCKER_HOST=unix:///run/user/<uid>/docker.sock` (rootless daemon), `BUZZ_BIN_DIR` with
  `buzz`, `buzz-acp`, `buzz-agent`, `buzz-dev-mcp` built for Ubuntu 24.04 glibc;
- `GRANTS_FILE` (owner → community relay URL → capabilities/workspaces; edits apply live and
  revocation ends running sessions), `STATE_DIR` and `DATA_ROOT` on private storage;
- `PUBLIC_BASE_URL=https://buzz.example.com/app/api/agent-control`, `ALLOWED_ORIGINS` set to the
  Web origin, `TRUSTED_PROXY_IPS` set to the edge proxy;
- model credentials in its own environment only (`AGENT_LLM_*`).

TLS terminates at the load balancer/edge; never publish the listener directly. Workload containers
get only their own data directory and read-only Buzz binaries — no Docker socket, host network or
published ports. Then set `"agentControlUrl": "https://buzz.example.com/app/api/agent-control"` in
`config.json`. Full reference: [agent-control/README.md](../agent-control/README.md).

## Start

From the repository root:

```bash
export BUZZ_WEB_BIND_ADDRESS=10.0.0.10
export BUZZ_WEB_PORT=3001
docker compose -f deploy/compose.yml config
docker compose -f deploy/compose.yml build --pull
docker compose -f deploy/compose.yml up -d
docker compose -f deploy/compose.yml ps
```

`deploy/config.json` is public runtime configuration. Replace its example `relayUrl` with the
deployment's explicit `ws://` or `wss://` Relay address; an empty value is rejected. Never put an
`nsec`, Relay API token, owner key, provider credential, or private-only endpoint in it.
`features.projects` and `features.forum` are deployment policy flags; the browser has no local
override. Existing NIP-34 repositories and Forum channels remain visible when the corresponding
Relay content already exists.

Recreate only the Web container after changing the bind-mounted runtime configuration:

```bash
docker compose -f deploy/compose.yml up -d --no-deps --force-recreate web
```

## Verify

On the private host:

```bash
curl --fail --show-error http://10.0.0.10:3001/app/healthz
curl --fail --show-error http://10.0.0.10:3000/_liveness
```

After public routing is active:

```bash
curl --fail --show-error https://buzz.example.com/app/healthz
curl --fail --show-error https://buzz.example.com/_liveness
```

Open `https://buzz.example.com/app/` and authenticate through NIP-07 or an encrypted local `nsec`
vault. Prefer NIP-07 on shared devices because an unlocked local key exists in page memory.

## Upgrade and Rollback

Rebuild and recreate the Web container without touching Relay volumes:

```bash
docker compose -f deploy/compose.yml build --pull
docker compose -f deploy/compose.yml up -d
```

For rollback, restore the previous Web image and edge route. The service worker caches only
content-hashed `/app/assets/*`; it does not cache HTML, runtime configuration, messages, prompts, or
Relay API responses.
