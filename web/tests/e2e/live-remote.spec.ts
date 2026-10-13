import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { schnorr } from "@noble/curves/secp256k1.js";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  identityFromEnvironment,
  importIdentity,
  type LiveIdentity,
  liveRelayUrl,
} from "./support/live-session";

type Signer = { pubkey: string; secretKey: Uint8Array };
type ApiResult = { status: number; json: Record<string, unknown> | null; bytes: Buffer };

const controlUrl = (process.env.BUZZ_LIVE_AGENT_CONTROL_URL ?? "").replace(/\/$/, "");
const grantsFile = process.env.BUZZ_LIVE_REMOTE_GRANTS_FILE ?? "";
const evidenceDir = process.env.BUZZ_LIVE_EVIDENCE_DIR ?? "test-results/live-remote";
const evidence: Record<string, unknown> = {};

function requireEnvironment() {
  if (!controlUrl) throw new Error("BUZZ_LIVE_AGENT_CONTROL_URL is required.");
  if (!grantsFile) throw new Error("BUZZ_LIVE_REMOTE_GRANTS_FILE is required.");
  // The workspace containers live in a dedicated rootless daemon, never the system socket.
  const docker = process.env.DOCKER_HOST ?? "";
  if (!docker.startsWith("unix://") || docker.includes("/var/run/docker.sock")) {
    throw new Error("DOCKER_HOST must point at the task's rootless Docker socket.");
  }
}

function record(key: string, value: unknown) {
  evidence[key] = value;
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, "live-remote-evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
}

async function screenshot(page: Page, name: string) {
  mkdirSync(join(evidenceDir, "screenshots"), { recursive: true });
  await page.screenshot({ path: join(evidenceDir, "screenshots", `${name}.png`) });
}

function authorization(signer: Signer, url: string, method: string, body: Uint8Array | string) {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["u", url],
        ["method", method],
        ["payload", createHash("sha256").update(body).digest("hex")],
        ["nonce", randomUUID()],
      ],
    },
    signer.secretKey,
  );
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

function apiUrl(path: string, query: Record<string, string> = {}) {
  return `${controlUrl}${path}?${new URLSearchParams({ relay: liveRelayUrl(), ...query })}`;
}

async function api(
  signer: Signer,
  method: string,
  path: string,
  options: {
    query?: Record<string, string>;
    json?: unknown;
    raw?: Uint8Array;
    header?: string;
  } = {},
): Promise<ApiResult & { header: string }> {
  const url = apiUrl(path, options.query);
  const body = options.raw ?? (options.json === undefined ? "" : JSON.stringify(options.json));
  const header = options.header ?? authorization(signer, url, method, body);
  const response = await fetch(url, {
    method,
    headers: { Authorization: header, "Content-Type": "application/json" },
    body: method === "GET" ? undefined : body,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let json: Record<string, unknown> | null = null;
  if ((response.headers.get("content-type") ?? "").includes("json"))
    json = JSON.parse(bytes.toString());
  return { status: response.status, json, bytes, header };
}

function errorCode(result: ApiResult): unknown {
  const error = result.json?.error;
  return error && typeof error === "object" && "code" in error ? error.code : null;
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function workspaceContainer(id: string): string {
  const name = docker([
    "ps",
    "-a",
    "--filter",
    `label=buzz.workspace=${id}`,
    "--format",
    "{{.Names}}",
  ]);
  expect(name, `container for ${id}`).toMatch(/^buzz-ws-[0-9a-f]{16}$/);
  return name;
}

/** Processes started by sessions (everything except init, the keep-alive and the probe). */
function sessionProcesses(container: string): string[] {
  return docker(["exec", container, "ps", "-eo", "pid,sid,args"])
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => !/docker-init|sleep infinity|ps -eo/.test(line));
}

async function waitForProcesses(container: string, predicate: (lines: string[]) => boolean) {
  await expect.poll(() => predicate(sessionProcesses(container)), { timeout: 15_000 }).toBe(true);
  return sessionProcesses(container);
}

function rewriteGrants(mutate: (owners: Record<string, unknown>) => void) {
  const document = JSON.parse(readFileSync(grantsFile, "utf8"));
  mutate(document.owners);
  writeFileSync(`${grantsFile}.live-remote`, `${JSON.stringify(document, null, 2)}\n`);
  renameSync(`${grantsFile}.live-remote`, grantsFile);
}

async function openRemote(page: Page) {
  const direct = page.getByRole("button", { name: "Remote workspace", exact: true });
  const more = page.getByRole("button", { name: "More tools" });
  await expect(direct.or(more).first()).toBeVisible({ timeout: 30_000 });
  if (await direct.isVisible()) {
    await direct.click();
  } else {
    await more.click();
    await page.getByRole("menuitemradio", { name: "Remote workspace" }).click();
  }
  await expect(page.getByTestId("workspace-tool-remote")).toBeVisible();
}

async function terminalText(view: Locator): Promise<string> {
  return view.locator(".xterm-rows").innerText();
}

async function typeInTerminal(page: Page, view: Locator, text: string) {
  await view.getByTestId("remote-terminal").click();
  await page.keyboard.type(text);
}

async function sttySize(page: Page, view: Locator, marker: string): Promise<string> {
  await typeInTerminal(page, view, `echo ${marker}-$(stty size | tr ' ' x)\n`);
  const pattern = new RegExp(`${marker}-(\\d+x\\d+)`);
  await expect.poll(async () => pattern.exec(await terminalText(view))?.[1] ?? null).not.toBeNull();
  return pattern.exec(await terminalText(view))?.[1] ?? "";
}

test.beforeAll(requireEnvironment);

test("remote terminal, files, MCP tools, escapes, cross-owner and revocation", async ({ page }) => {
  const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
  const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
  const strangerKey = generateSecretKey();
  const stranger = { secretKey: strangerKey, pubkey: getPublicKey(strangerKey) };
  const originalGrants = readFileSync(grantsFile, "utf8");
  const id = `live-${Date.now().toString(36)}`;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await importIdentity(page, member);
    await openRemote(page);
    const view = page.getByTestId("workspace-tool-remote");
    await expect(view.getByRole("heading", { name: "Workspaces", exact: true })).toBeVisible();
    const idInput = view.getByLabel("Workspace ID");
    if (!(await idInput.isVisible()))
      await view.getByRole("button", { name: "New workspace" }).click();
    await idInput.fill(id);
    await view.getByLabel("Display name").fill(id);
    await view.getByRole("button", { name: "Create workspace" }).click();
    await expect(view.getByRole("heading", { name: id, exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const container = workspaceContainer(id);
    const inspect = JSON.parse(docker(["inspect", container]))[0];
    record("containment", {
      container,
      user: inspect.Config.User,
      binds: inspect.HostConfig.Binds.map((bind: string) =>
        bind.replace(/^.*\/(\.tmp|target)\//, "…/$1/"),
      ),
      readonlyRootfs: inspect.HostConfig.ReadonlyRootfs,
      capDrop: inspect.HostConfig.CapDrop,
      securityOpt: inspect.HostConfig.SecurityOpt,
      memory: inspect.HostConfig.Memory,
      pidsLimit: inspect.HostConfig.PidsLimit,
      nanoCpus: inspect.HostConfig.NanoCpus,
      networkMode: inspect.HostConfig.NetworkMode,
      privileged: inspect.HostConfig.Privileged,
    });
    expect(inspect.HostConfig.Privileged).toBe(false);
    expect(inspect.HostConfig.Binds.some((bind: string) => bind.includes("docker.sock"))).toBe(
      false,
    );

    // Terminal: real effects, resize, process cleanup on close.
    const status = view.getByTestId("remote-terminal-status");
    await expect(status).toHaveText("Connected", { timeout: 30_000 });
    await typeInTerminal(
      page,
      view,
      "echo created-by-terminal > term.txt; ln -s /etc/passwd leak; ln -s / rootlink\n",
    );
    const before = await sttySize(page, view, "size1");
    await page.setViewportSize({ width: 1100, height: 700 });
    await expect.poll(() => sttySize(page, view, `size${Date.now() % 1000}`)).not.toBe(before);
    const after = await sttySize(page, view, "size2");
    await page.setViewportSize({ width: 1440, height: 900 });
    await typeInTerminal(page, view, "sleep 321 &\n");
    const running = await waitForProcesses(container, (lines) =>
      lines.some((line) => line.includes("sleep 321")),
    );
    await screenshot(page, "desktop-terminal");
    await view.getByRole("button", { name: "End session" }).click();
    await expect(status).toHaveText("Session ended");
    const afterClose = await waitForProcesses(
      container,
      (lines) => !lines.some((line) => line.includes("sleep 321") || line.includes("bash -il")),
    );
    record("terminal", { sizeBefore: before, sizeAfterResize: after, running, afterClose });
    expect(before).not.toBe(after);

    // Files: the terminal's file is visible, editable, downloadable; uploads persist.
    await view.getByRole("tab", { name: "Files" }).click();
    await view.getByRole("button", { name: "Open term.txt" }).click();
    const editor = view.getByRole("textbox", { name: "Editing term.txt" });
    await expect(editor).toHaveValue("created-by-terminal\n");
    await editor.fill("edited-in-browser\n");
    await view.getByRole("button", { name: "Save file" }).click();
    await expect(view.getByText("Unsaved changes")).toHaveCount(0);
    const saved = await api(member, "GET", `/v1/workspaces/${id}/file`, {
      query: { path: "term.txt" },
    });
    expect(saved.bytes.toString()).toBe("edited-in-browser\n");
    const uploadBytes = randomBytes(2048);
    await view.getByTestId("remote-upload-input").setInputFiles({
      name: "upload.bin",
      mimeType: "application/octet-stream",
      buffer: uploadBytes,
    });
    await expect(view.getByRole("button", { name: "Open upload.bin" })).toBeVisible();
    const uploaded = await api(member, "GET", `/v1/workspaces/${id}/file`, {
      query: { path: "upload.bin" },
    });
    expect(uploaded.bytes.equals(uploadBytes)).toBe(true);
    const downloadEvent = page.waitForEvent("download");
    await view.getByRole("button", { name: "Download term.txt" }).click();
    const download = await downloadEvent;
    const downloaded = readFileSync((await download.path()) ?? "", "utf8");
    expect(downloaded).toBe("edited-in-browser\n");
    await screenshot(page, "desktop-files");

    // Escapes: symlink, parent and absolute paths are refused inside the container.
    await view.getByRole("button", { name: "Open leak" }).click();
    await expect(
      view.getByRole("alert").filter({ hasText: "That path is outside the workspace" }),
    ).toBeVisible();
    const escapes = {
      symlinkFile: await api(member, "GET", `/v1/workspaces/${id}/file`, {
        query: { path: "leak" },
      }),
      symlinkDir: await api(member, "GET", `/v1/workspaces/${id}/files`, {
        query: { path: "rootlink/etc" },
      }),
      symlinkWrite: await api(member, "PUT", `/v1/workspaces/${id}/file`, {
        query: { path: "rootlink/tmp/planted" },
        raw: Buffer.from("x"),
      }),
      parent: await api(member, "GET", `/v1/workspaces/${id}/file`, {
        query: { path: "../etc/passwd" },
      }),
      absolute: await api(member, "GET", `/v1/workspaces/${id}/file`, {
        query: { path: "/etc/passwd" },
      }),
    };
    const escapeCodes = Object.fromEntries(
      Object.entries(escapes).map(([key, value]) => [key, [value.status, errorCode(value)]]),
    );
    record("escapes", escapeCodes);
    for (const value of Object.values(escapes)) {
      expect(value.status).toBe(400);
      expect(errorCode(value)).toBe("path_escape");
    }
    expect(
      docker(["exec", container, "sh", "-c", "test -e /tmp/planted && echo yes || echo no"]),
    ).toBe("no");

    // MCP: a real file through buzz-dev-mcp, then a cancelled long call that never finishes.
    await view.getByRole("tab", { name: "Tools" }).click();
    await view.getByRole("button", { name: "shell", exact: true }).click();
    const command = view.locator("#remote-mcp-field-command");
    await command.fill("echo made-by-mcp > mcp.txt && cat mcp.txt");
    await view.getByRole("button", { name: "Run tool" }).click();
    await expect(view.getByTestId("remote-mcp-outcome")).toContainText("made-by-mcp");
    const mcpFile = await api(member, "GET", `/v1/workspaces/${id}/file`, {
      query: { path: "mcp.txt" },
    });
    expect(mcpFile.bytes.toString()).toBe("made-by-mcp\n");
    await screenshot(page, "desktop-tools");
    await command.fill("sleep 45 && touch late.txt");
    await view.getByRole("button", { name: "Run tool" }).click();
    const longRunning = await waitForProcesses(container, (lines) =>
      lines.some((line) => line.includes("sleep 45")),
    );
    await view.getByRole("button", { name: "Cancel tool call" }).click();
    await expect(view.getByTestId("remote-mcp-outcome")).toContainText("Tool call cancelled");
    const afterCancel = await waitForProcesses(
      container,
      (lines) => !lines.some((line) => line.includes("sleep 45")),
    );
    const late = await api(member, "GET", `/v1/workspaces/${id}/file`, {
      query: { path: "late.txt" },
    });
    record("mcp", {
      file: mcpFile.bytes.toString(),
      longRunning,
      afterCancel,
      lateFileStatus: late.status,
    });
    expect(late.status).toBe(404);

    // Cross-owner, ungranted and replayed requests have no effect.
    const adminList = await api(admin, "GET", "/v1/workspaces");
    const adminFiles = await api(admin, "GET", `/v1/workspaces/${id}/files`, {
      query: { path: "" },
    });
    const adminCall = await api(admin, "POST", `/v1/workspaces/${id}/mcp/calls`, {
      json: { callId: "foreign-1", name: "shell", arguments: { command: "touch pwned" } },
    });
    const strangerList = await api(stranger, "GET", "/v1/workspaces");
    const fresh = await api(member, "GET", "/v1/workspaces");
    const replay = await api(member, "GET", "/v1/workspaces", { header: fresh.header });
    const pwned = await api(member, "GET", `/v1/workspaces/${id}/file`, {
      query: { path: "pwned" },
    });
    record("crossOwner", {
      adminSeesWorkspace: JSON.stringify(adminList.json).includes(id),
      adminFiles: [adminFiles.status, errorCode(adminFiles)],
      adminCall: [adminCall.status, errorCode(adminCall)],
      stranger: [strangerList.status, errorCode(strangerList)],
      replay: [replay.status, errorCode(replay)],
      pwnedFile: pwned.status,
    });
    expect(JSON.stringify(adminList.json)).not.toContain(id);
    expect(adminFiles.status).toBe(404);
    expect(adminCall.status).toBe(404);
    expect(errorCode(strangerList)).toBe("forbidden");
    expect(errorCode(replay)).toBe("replayed");
    expect(pwned.status).toBe(404);

    // Mobile layout.
    await page.setViewportSize({ width: 390, height: 844 });
    await view.getByRole("tab", { name: "Files" }).click();
    await screenshot(page, "mobile-files");
    await view.getByRole("tab", { name: "Terminal" }).click();
    await view.getByRole("button", { name: "New session" }).click();
    await expect(status).toHaveText("Connected", { timeout: 30_000 });
    await typeInTerminal(page, view, "ls\n");
    await expect.poll(() => terminalText(view)).toContain("mcp.txt");
    await screenshot(page, "mobile-terminal");
    await view.getByRole("button", { name: "Back to workspaces" }).click();
    await screenshot(page, "mobile-workspaces");
    await view.getByRole("button", { name: `Open workspace ${id}` }).click();
    await page.setViewportSize({ width: 1440, height: 900 });

    // Revocation while a terminal is live.
    await expect(status).toHaveText("Connected", { timeout: 30_000 });
    await typeInTerminal(page, view, "sleep 400 &\n");
    await waitForProcesses(container, (lines) => lines.some((line) => line.includes("sleep 400")));
    rewriteGrants((owners) => {
      delete owners[member.pubkey];
    });
    await expect(status).toHaveText("Session closed: access revoked", { timeout: 15_000 });
    const revokedProcesses = await waitForProcesses(
      container,
      (lines) => !lines.some((line) => line.includes("sleep 400") || line.includes("bash -il")),
    );
    const revokedCalls = {
      files: await api(member, "GET", `/v1/workspaces/${id}/files`, { query: { path: "" } }),
      ticket: await api(member, "POST", `/v1/workspaces/${id}/terminal-tickets`),
      tools: await api(member, "GET", `/v1/workspaces/${id}/mcp/tools`),
      write: await api(member, "PUT", `/v1/workspaces/${id}/file`, {
        query: { path: "after-revoke" },
        raw: Buffer.from("x"),
      }),
    };
    await expect(view.getByRole("heading", { name: "Remote access was revoked" })).toBeVisible({
      timeout: 30_000,
    });
    await screenshot(page, "desktop-revoked");
    record("revocation", {
      processesAfterRevoke: revokedProcesses,
      calls: Object.fromEntries(
        Object.entries(revokedCalls).map(([k, v]) => [k, [v.status, errorCode(v)]]),
      ),
    });
    for (const value of Object.values(revokedCalls)) expect(errorCode(value)).toBe("revoked");
    writeFileSync(grantsFile, originalGrants);
    await expect
      .poll(
        async () =>
          (await api(member, "GET", `/v1/workspaces/${id}/files`, { query: { path: "" } })).status,
      )
      .toBe(200);
    const afterRevokeFile = await api(member, "GET", `/v1/workspaces/${id}/file`, {
      query: { path: "after-revoke" },
    });
    expect(afterRevokeFile.status).toBe(404);

    // Delete through the UI removes the container.
    await page.reload();
    await page.getByLabel("Vault passphrase").fill(member.vaultPassphrase);
    await page.getByRole("button", { name: "Unlock" }).click();
    await openRemote(page);
    await view.getByRole("button", { name: `Delete workspace ${id}` }).click();
    await view.getByRole("button", { name: "Delete workspace", exact: true }).click();
    // The confirm step replaces the row, so wait for the service's result, not the row.
    await expect(page.getByText(`Workspace ${id} deleted`)).toBeVisible({ timeout: 90_000 });
    const list = await api(member, "GET", "/v1/workspaces");
    const remaining = docker([
      "ps",
      "-a",
      "--filter",
      `label=buzz.workspace=${id}`,
      "--format",
      "{{.Names}}",
    ]);
    record("deletion", {
      listedAfterDelete: JSON.stringify(list.json).includes(id),
      containerRemaining: remaining,
    });
    expect(JSON.stringify(list.json)).not.toContain(id);
    expect(remaining).toBe("");
  } finally {
    writeFileSync(grantsFile, originalGrants);
  }
});

function readFrames(socket: WebSocket) {
  const frames: { type: string; [key: string]: unknown }[] = [];
  socket.addEventListener("message", (event) => frames.push(JSON.parse(String(event.data))));
  return frames;
}

async function openSocket(signer: Signer, id: string, session?: string): Promise<WebSocket> {
  const ticket = await api(signer, "POST", `/v1/workspaces/${id}/terminal-tickets`);
  expect(ticket.status).toBe(201);
  const url = new URL(`${controlUrl.replace(/^http/, "ws")}/v1/workspaces/${id}/terminal`);
  url.searchParams.set("ticket", String(ticket.json?.ticket));
  if (session) url.searchParams.set("session", session);
  const socket = new WebSocket(url);
  const opened = Promise.withResolvers<void>();
  socket.addEventListener("open", () => opened.resolve(), { once: true });
  socket.addEventListener("error", () => opened.reject(new Error("terminal upgrade refused")), {
    once: true,
  });
  await opened.promise;
  return socket;
}

async function presence(signer: LiveIdentity, agent: string): Promise<string[]> {
  const relayHttp = liveRelayUrl().replace(/^ws/, "http");
  const url = `${relayHttp}/query`;
  const body = JSON.stringify([{ kinds: [20001], authors: [agent] }]);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization(signer, url, "POST", body),
      "Content-Type": "application/json",
    },
    body,
  });
  const events: unknown = await response.json();
  if (!Array.isArray(events)) throw new Error("presence query failed");
  return events.map((event) => String(event?.content));
}

function agentStatus(result: ApiResult): unknown {
  const agent = result.json?.agent;
  return agent && typeof agent === "object" && "status" in agent ? agent.status : null;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

test("terminal reconnect window expiry and contained agent lifecycle", async () => {
  const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
  const id = `live-${Date.now().toString(36)}-r`;
  const created = await api(member, "POST", "/v1/workspaces", { json: { id, name: id } });
  expect(created.status).toBe(201);
  const container = workspaceContainer(id);
  try {
    // Drop the socket, resume inside the window, then let the window lapse.
    const first = await openSocket(member, id);
    const firstFrames = readFrames(first);
    await expect.poll(() => firstFrames.find((frame) => frame.type === "session")).toBeTruthy();
    const session = String(firstFrames.find((frame) => frame.type === "session")?.id);
    first.send(JSON.stringify({ type: "input", data: "sleep 222 &\n" }));
    await waitForProcesses(container, (lines) => lines.some((line) => line.includes("sleep 222")));
    first.close();
    await delay(3000);
    const resumed = await openSocket(member, id, session);
    const resumedFrames = readFrames(resumed);
    resumed.send(JSON.stringify({ type: "input", data: "echo resumed-$((40+2))\n" }));
    await expect
      .poll(() =>
        resumedFrames.some(
          (frame) => frame.type === "output" && String(frame.data).includes("resumed-42"),
        ),
      )
      .toBe(true);
    resumed.close();
    const detachedAt = Date.now();
    const stillThere = sessionProcesses(container);
    expect(stillThere.some((line) => line.includes("sleep 222"))).toBe(true);
    await expect
      .poll(() => sessionProcesses(container).some((line) => line.includes("sleep 222")), {
        timeout: 90_000,
        intervals: [2000],
      })
      .toBe(false);
    const killedAfterMs = Date.now() - detachedAt;
    const lateResume = await openSocket(member, id, session).then(
      () => "accepted",
      () => "refused",
    );
    record("reconnect", { session: session.slice(0, 6), stillThere, killedAfterMs, lateResume });
    expect(killedAfterMs).toBeGreaterThan(55_000);
    expect(lateResume).toBe("refused");

    // Agent: keypair server-side, NIP-OA authorization, observed Docker + relay presence.
    const agent = await api(member, "POST", "/v1/agents", {
      json: { name: `Live Remote ${id}`, config: { respondTo: "owner-only" } },
    });
    expect(agent.status).toBe(201);
    const pubkey = String(agent.json?.pubkey);
    const challenge = String(agent.json?.authChallenge);
    const digest = createHash("sha256").update(challenge).digest();
    const sig = Buffer.from(schnorr.sign(new Uint8Array(digest), member.secretKey)).toString("hex");
    const early = await api(member, "POST", `/v1/agents/${pubkey}/start`);
    const authorized = await api(member, "POST", `/v1/agents/${pubkey}/authorize`, {
      json: { authTag: ["auth", member.pubkey, "", sig] },
    });
    expect(errorCode(early)).toBe("not_authorized");
    expect(authorized.status).toBe(200);
    const agentContainer = `buzz-agent-${pubkey.slice(0, 16)}`;
    const started = await api(member, "POST", `/v1/agents/${pubkey}/start`);
    const startedDocker = docker(["inspect", "-f", "{{.State.Status}}", agentContainer]);
    await expect.poll(() => presence(member, pubkey), { timeout: 30_000 }).toContain("online");
    const logs = await api(member, "GET", `/v1/agents/${pubkey}/logs`, { query: { tail: "200" } });
    const logText = JSON.stringify(logs.json);
    const stopped = await api(member, "POST", `/v1/agents/${pubkey}/stop`);
    const stoppedDocker = docker([
      "inspect",
      "-f",
      "{{.State.Status}} {{.State.ExitCode}}",
      agentContainer,
    ]);
    await expect.poll(() => presence(member, pubkey), { timeout: 30_000 }).toEqual([]);
    const removed = await api(member, "DELETE", `/v1/agents/${pubkey}`);
    const remaining = docker([
      "ps",
      "-a",
      "--filter",
      `name=${agentContainer}`,
      "--format",
      "{{.Names}}",
    ]);
    record("agent", {
      agent: pubkey.slice(0, 8),
      earlyStart: errorCode(early),
      startedStatus: agentStatus(started),
      startedDocker,
      presenceOnline: true,
      logLines: Array.isArray(logs.json?.lines) ? logs.json.lines.length : 0,
      logHasNsec: /nsec1[02-9ac-hj-np-z]{20,}/.test(logText),
      logHasAuthSig: logText.includes(sig),
      stoppedStatus: agentStatus(stopped),
      stoppedDocker,
      presenceAfterStop: [],
      deleted: removed.status,
      containerRemaining: remaining,
    });
    expect(startedDocker).toBe("running");
    expect(logText).not.toMatch(/nsec1[02-9ac-hj-np-z]{20,}/);
    expect(logText).not.toContain(sig);
    expect(stoppedDocker.startsWith("exited")).toBe(true);
    expect(removed.status).toBe(200);
    expect(remaining).toBe("");
  } finally {
    await api(member, "DELETE", `/v1/workspaces/${id}`);
  }
});
