import { resolve } from "node:path";

function integer(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max || String(value) !== raw.trim()) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function required(env, name) {
  const value = (env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isLocalHttp(url) {
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

/** Validate the whole service configuration before listening (fail fast, no defaults for paths). */
export function loadConfig(env = process.env) {
  const publicBaseUrl = required(env, "PUBLIC_BASE_URL").replace(/\/$/, "");
  const base = new URL(publicBaseUrl);
  if (base.protocol !== "https:" && !isLocalHttp(base)) {
    throw new Error("PUBLIC_BASE_URL must use HTTPS (http only for 127.0.0.1/localhost)");
  }
  if (base.search || base.hash) throw new Error("PUBLIC_BASE_URL must not have a query or fragment");
  const dockerHost = required(env, "DOCKER_HOST");
  if (!dockerHost.startsWith("unix://")) throw new Error("DOCKER_HOST must be a unix:// socket");
  const socketPath = dockerHost.slice("unix://".length);
  if (socketPath === "/var/run/docker.sock" || socketPath === "/run/docker.sock") {
    throw new Error("Refusing the system Docker socket; point DOCKER_HOST at a rootless daemon");
  }
  const allowedOrigins = new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        const url = new URL(value);
        if (url.origin !== value) throw new Error(`ALLOWED_ORIGINS entry must be an origin: ${value}`);
        return value;
      }),
  );
  const llmBaseUrl = (env.AGENT_LLM_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (llmBaseUrl) new URL(llmBaseUrl);
  const dataRoot = resolve(required(env, "DATA_ROOT"));
  return {
    listenHost: env.LISTEN_HOST || "127.0.0.1",
    listenPort: integer(env, "LISTEN_PORT", 8095, { min: 1, max: 65535 }),
    publicBaseUrl,
    allowedOrigins,
    trustedProxies: new Set(
      (env.TRUSTED_PROXY_IPS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    grantsFile: resolve(required(env, "GRANTS_FILE")),
    stateDir: resolve(required(env, "STATE_DIR")),
    dataRoot,
    socketRoot: resolve(env.SOCKET_ROOT || `${dataRoot}/sock`),
    dockerSocket: socketPath,
    binDir: resolve(required(env, "BUZZ_BIN_DIR")),
    limits: {
      memoryBytes: integer(env, "CONTAINER_MEMORY_MB", 512, { min: 64, max: 65536 }) * 1024 * 1024,
      pids: integer(env, "CONTAINER_PIDS", 256, { min: 16, max: 4096 }),
      nanoCpus: integer(env, "CONTAINER_MILLICPUS", 1000, { min: 100, max: 64000 }) * 1_000_000,
    },
    terminal: {
      ticketSeconds: integer(env, "TERMINAL_TICKET_SECONDS", 30, { min: 5, max: 30 }),
      reconnectSeconds: integer(env, "TERMINAL_RECONNECT_SECONDS", 60, { min: 5, max: 600 }),
      maxSeconds: integer(env, "TERMINAL_MAX_SECONDS", 14_400, { min: 60, max: 86_400 }),
      maxPerOwner: integer(env, "TERMINAL_MAX_PER_OWNER", 4, { min: 1, max: 32 }),
    },
    llm: {
      provider: env.AGENT_LLM_PROVIDER || "openai",
      api: env.AGENT_LLM_API || "chat",
      baseUrl: llmBaseUrl || null,
      apiKey: env.AGENT_LLM_API_KEY || null,
      defaultModel: env.AGENT_DEFAULT_MODEL || null,
    },
  };
}
