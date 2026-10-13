import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Browser, chromium, expect, type Page, test } from "@playwright/test";
import { nip19 } from "nostr-tools";
import { finalizeEvent, type NostrEvent } from "nostr-tools/pure";
import {
  archiveChannel,
  browserEnvironment,
  createPrivateChannel,
  identityFromEnvironment,
  importIdentity,
  type LiveIdentity,
  liveRelayUrl,
  openChannel,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

// Real-runtime agent acceptance: Agent Control (rootless containers running buzz-acp +
// buzz-agent against a deterministic OpenAI-compatible stub model), the real Relay, and this
// browser build. The model output is synthetic; process, relay, crypto and UI paths are real.

const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
const MODEL = "buzz-synthetic-echo";
const EVIDENCE = path.resolve(process.env.BUZZ_LIVE_EVIDENCE_DIR ?? "test-results/live-agents");

function controlUrl(): string {
  const value = process.env.BUZZ_LIVE_AGENT_CONTROL_URL?.trim();
  if (!value) throw new Error("BUZZ_LIVE_AGENT_CONTROL_URL is required.");
  return value.replace(/\/$/, "");
}

function evidence(name: string, value: unknown) {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), `${JSON.stringify(value, null, 2)}\n`);
}

function nip98(identity: LiveIdentity, url: string, method: string, body: string): string {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["u", url],
        ["method", method],
        ["payload", createHash("sha256").update(body).digest("hex")],
        ["nonce", randomBytes(16).toString("hex")],
      ],
    },
    identity.secretKey,
  );
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

async function control(
  identity: LiveIdentity,
  method: string,
  route: string,
  options: { body?: unknown; authorization?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; authorization: string }> {
  const url = `${controlUrl()}${route}?relay=${encodeURIComponent(liveRelayUrl())}`;
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const authorization = options.authorization ?? nip98(identity, url, method, body);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : body,
  });
  return {
    status: response.status,
    body: ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>,
    authorization,
  };
}

/** Relay presence as the relay itself reports it (HTTP /query, NIP-98). */
async function presenceOf(agent: string): Promise<string | null> {
  const relay = new URL(liveRelayUrl());
  relay.protocol = relay.protocol === "wss:" ? "https:" : "http:";
  const url = `${relay.origin}/query`;
  const body = JSON.stringify([{ kinds: [20001], authors: [agent], limit: 1 }]);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: nip98(admin, url, "POST", body), "Content-Type": "application/json" },
    body,
  });
  const events = (await response.json()) as NostrEvent[];
  return events[0]?.content ?? null;
}

/** Poll a probe; transient relay rate limits (shared test runtime) count as "not yet". */
async function waitUntil<T>(probe: () => Promise<T>, accept: (value: T) => boolean, ms = 90_000) {
  const deadline = Date.now() + ms;
  const attempt = () => probe().catch(() => undefined);
  let value = await attempt();
  while ((value === undefined || !accept(value)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    value = await attempt();
  }
  expect(
    value !== undefined && accept(value),
    `condition not reached; last value ${JSON.stringify(value)}`,
  ).toBe(true);
  return value as T;
}

async function rejectedQuery(relay: NodeRelayClient, filter: Record<string, unknown>) {
  try {
    return { events: (await relay.query([filter])).length, closed: null };
  } catch (error) {
    return { events: 0, closed: error instanceof Error ? error.message : String(error) };
  }
}

async function openAgents(page: Page) {
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Agents" })
    .click();
  await expect(page.getByTestId("workspace-tool-agents")).toBeVisible();
}

test("owner creates, observes, controls and removes a real managed agent", async () => {
  const run = `${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
  const channelName = `agents-${run}`;
  const agentName = `probe-${run}`;
  const baseURL = test.info().project.use.baseURL as string;
  const browser: Browser = await chromium.launch({ env: browserEnvironment() });
  const context = await browser.newContext({
    baseURL,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const adminRelay = await NodeRelayClient.connect(liveRelayUrl(), admin.secretKey);
  const memberRelay = await NodeRelayClient.connect(liveRelayUrl(), member.secretKey);
  let agent = "";
  const log: Record<string, unknown> = { run };
  try {
    await importIdentity(page, admin);
    await createPrivateChannel(page, channelName);
    const channelId = await waitUntil(
      async () =>
        (await adminRelay.query([{ kinds: [39000], limit: 200 }])).find((event) =>
          event.tags.some((tag) => tag[0] === "name" && tag[1] === channelName),
        ),
      Boolean,
    ).then((event) => event?.tags.find((tag) => tag[0] === "d")?.[1] ?? "");
    expect(channelId).not.toBe("");

    // 1. Create from a persona: Agent Control mints the key, the browser signs NIP-OA.
    await openAgents(page);
    const tool = page.getByTestId("workspace-tool-agents");
    await tool.getByRole("tab", { name: "Personas" }).click();
    await tool.getByRole("button", { name: "New persona" }).click();
    const personaDialog = page.getByRole("dialog", { name: "New persona" });
    await personaDialog.getByLabel("Name").fill(agentName);
    await personaDialog.getByLabel("Model").fill(MODEL);
    await personaDialog.getByLabel("Instructions").fill(`Live acceptance persona ${run}`);
    await personaDialog.getByLabel("Responds to").selectOption("anyone");
    await personaDialog.getByRole("button", { name: "Save persona" }).click();
    await expect(personaDialog).toHaveCount(0);
    const personaRow = tool
      .getByTestId("agent-personas")
      .locator("li")
      .filter({ hasText: agentName });
    await personaRow.getByRole("button", { name: "Create agent" }).click();
    const create = page.getByRole("dialog", { name: "New agent" });
    await expect(create.getByLabel("Name")).toHaveValue(agentName);
    await expect(create.getByLabel("Model")).toHaveValue(MODEL);
    await expect(create.getByLabel("Responds to")).toHaveValue("anyone");
    await create.getByLabel(`#${channelName}`).check();
    await create.getByRole("button", { name: "Create agent" }).click();
    await expect(create).toHaveCount(0, { timeout: 60_000 });
    const panel = tool.getByRole("complementary", { name: `Manage ${agentName}` });
    await expect(panel.getByTestId("managed-agent-status")).toHaveText("Process: stopped");

    const listed = await control(admin, "GET", "/v1/agents");
    const created = (listed.body.agents as Array<Record<string, unknown>>).find(
      (item) => item.name === agentName,
    );
    agent = String(created?.pubkey ?? "");
    expect(agent).toMatch(/^[0-9a-f]{64}$/);
    expect(created?.authorized).toBe(true);
    expect(JSON.stringify(listed.body)).not.toMatch(/nsec1|private_key|privateKey/);

    // The server published kind 0 with a NIP-OA tag that verifies for this owner, plus 10100.
    const profile = await adminRelay.waitFor(
      [{ kinds: [0], authors: [agent] }],
      (e) => e.length > 0,
    );
    const authTag = profile[0]?.tags.find((tag) => tag[0] === "auth");
    expect(authTag?.[1]).toBe(admin.pubkey);
    await adminRelay.waitFor([{ kinds: [10100], authors: [agent] }], (e) => e.length > 0);
    await expect(panel.getByText("Managed by you")).toBeVisible({ timeout: 30_000 });
    const membership = await adminRelay.waitFor([{ kinds: [39002], "#d": [channelId] }], (events) =>
      events.some((event) => event.tags.some((tag) => tag[0] === "p" && tag[1] === agent)),
    );
    log.created = { agent, auth: Boolean(authTag), memberEvents: membership.length };

    // 2. Start: observed container state + relay presence.
    await panel.getByRole("button", { name: "Start", exact: true }).click();
    await expect(panel.getByTestId("managed-agent-status")).toHaveText(
      /Process: (starting|running)/,
      {
        timeout: 120_000,
      },
    );
    await waitUntil(
      () => presenceOf(agent),
      (value) => value === "online",
      120_000,
    );
    await expect(panel.getByTestId("managed-agent-status")).toHaveText("Process: running", {
      timeout: 60_000,
    });
    log.started = { presence: await presenceOf(agent) };
    await page.screenshot({
      path: path.join(EVIDENCE, "agents-detail-desktop.png"),
      fullPage: false,
    });

    // 3. Mention it in the channel (owner-signed kind 9 with a p tag), observe reply + activity.
    const mention = await adminRelay.publish(
      {
        kind: 9,
        created_at: Math.floor(Date.now() / 1000),
        content: `nostr:${nip19.npubEncode(agent)} please reply ${run}`,
        tags: [
          ["h", channelId],
          ["p", agent],
        ],
      },
      admin.secretKey,
    );
    const replies = await adminRelay.waitFor(
      [{ kinds: [9], authors: [agent], "#h": [channelId], since: mention.created_at - 1 }],
      (events) => events.length > 0,
      180_000,
    );
    const reply = replies[0];
    // Threaded to the mention (NIP-10 e tag) and the stub's fixed synthetic text.
    expect(reply?.content).toContain("[synthetic stub LLM] automated reply");
    expect(reply?.tags.some((tag) => tag[0] === "e" && tag[1] === mention.id)).toBe(true);
    log.reply = { count: replies.length, threadedToMention: true, content: reply?.content };

    await panel.getByRole("tab", { name: "Activity" }).click();
    await expect(panel.getByTestId("agent-history-sessions").locator("li").first()).toBeVisible({
      timeout: 60_000,
    });
    await panel.getByRole("tab", { name: "Usage" }).click();
    await expect(async () => {
      await panel.getByRole("tab", { name: "Memory" }).click();
      await panel.getByRole("tab", { name: "Usage" }).click();
      await expect(panel.getByTestId("agent-usage-totals")).toBeVisible({ timeout: 5_000 });
      const turns = await panel.getByTestId("agent-usage-totals").locator("dd").first().innerText();
      expect(Number(turns.replace(/\D/g, ""))).toBeGreaterThan(0);
    }).toPass({ timeout: 120_000 });
    await page.screenshot({ path: path.join(EVIDENCE, "agents-usage-desktop.png") });
    await panel.getByRole("tab", { name: "Memory" }).click();
    await expect(panel.getByRole("region", { name: "Memory" })).toBeVisible();
    await panel.getByRole("tab", { name: "Logs" }).click();
    await expect(panel.getByTestId("agent-runtime-logs")).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("agent-runtime-logs")).not.toContainText(
      /nsec1[02-9ac-hj-np-z]{20,}/,
    );

    // Owner-private records really exist and decrypt only for the owner.
    const metrics = await adminRelay.query([
      { kinds: [44200], "#p": [admin.pubkey], authors: [agent] },
    ]);
    expect(metrics.length).toBeGreaterThan(0);
    const memberMetrics = await rejectedQuery(memberRelay, {
      kinds: [44200],
      "#p": [admin.pubkey],
    });
    const memberMetricsById = await rejectedQuery(memberRelay, {
      ids: metrics.map((event) => event.id),
    });
    const memberMemory = await rejectedQuery(memberRelay, { kinds: [30174], authors: [agent] });
    expect(memberMetrics.events).toBe(0);
    expect(memberMetricsById.events).toBe(0);
    expect(memberMemory.events).toBe(0);
    log.privacy = { ownerMetrics: metrics.length, memberMetrics, memberMetricsById, memberMemory };

    // 4. A different identity and a replayed request cannot control the agent.
    const foreignStop = await control(member, "POST", `/v1/agents/${agent}/stop`);
    expect([403, 404]).toContain(foreignStop.status);
    const stillRunning = await control(admin, "GET", `/v1/agents/${agent}`);
    expect((stillRunning.body.agent as Record<string, unknown>).status).toBe("running");
    const replay = await control(admin, "GET", `/v1/agents/${agent}`, {
      authorization: stillRunning.authorization,
    });
    expect(replay.status).toBe(409);
    log.denied = {
      foreignStop: foreignStop.status,
      foreignError: foreignStop.body.error,
      replay: replay.body.error,
    };

    // 5. Stop / restart: process and relay presence follow.
    await panel.getByRole("tab", { name: "Overview" }).click();
    await panel.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(panel.getByTestId("managed-agent-status")).toHaveText("Process: stopped", {
      timeout: 120_000,
    });
    const stopped = await control(admin, "GET", `/v1/agents/${agent}`);
    expect((stopped.body.agent as Record<string, unknown>).status).toBe("stopped");
    await waitUntil(
      () => presenceOf(agent),
      (value) => value !== "online",
      120_000,
    );
    log.stopped = {
      presence: await presenceOf(agent),
      lastExit: (stopped.body.agent as Record<string, unknown>).lastExit,
    };

    await panel.getByRole("button", { name: "Restart", exact: true }).click();
    await expect(panel.getByTestId("managed-agent-status")).toHaveText("Process: running", {
      timeout: 120_000,
    });
    await waitUntil(
      () => presenceOf(agent),
      (value) => value === "online",
      120_000,
    );

    // 6. Removing channel access stops execution there: no reply after the 9001.
    await panel.getByRole("button", { name: `Remove from #${channelName}` }).click();
    await adminRelay.waitFor([{ kinds: [39002], "#d": [channelId] }], (events) =>
      events.every((event) => !event.tags.some((tag) => tag[0] === "p" && tag[1] === agent)),
    );
    const afterRemoval = await adminRelay.publish(
      {
        kind: 9,
        created_at: Math.floor(Date.now() / 1000),
        content: `nostr:${nip19.npubEncode(agent)} are you still here ${run}`,
        tags: [
          ["h", channelId],
          ["p", agent],
        ],
      },
      admin.secretKey,
    );
    await new Promise((resolve) => setTimeout(resolve, 25_000));
    const lateReplies = await adminRelay.query([
      { kinds: [9], authors: [agent], "#h": [channelId], since: afterRemoval.created_at },
    ]);
    expect(lateReplies).toHaveLength(0);
    log.removal = { repliesAfterRemoval: lateReplies.length };

    // Mobile layout of the real view.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(EVIDENCE, "agents-detail-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 900 });

    // 7. Remove: container and key gone.
    await panel.getByRole("button", { name: "Remove agent" }).click();
    await panel.getByRole("button", { name: "Remove permanently" }).click();
    await expect(panel).toHaveCount(0, { timeout: 120_000 });
    const gone = await control(admin, "GET", `/v1/agents/${agent}`);
    expect(gone.status).toBe(404);
    await waitUntil(
      () => presenceOf(agent),
      (value) => value !== "online",
      120_000,
    );
    log.removed = { status: gone.status };
    agent = "";
    await page.screenshot({ path: path.join(EVIDENCE, "agents-list-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(EVIDENCE, "agents-list-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await tool.getByRole("tab", { name: "Personas" }).click();
    await tool.getByRole("button", { name: `Delete ${agentName}` }).click();
    await tool.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(tool.getByText(agentName, { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await page.keyboard.press("Escape");
    await openChannel(page, channelName);
    await expect(page.getByText(`please reply ${run}`).first()).toBeVisible();
    await archiveChannel(page, channelName);
  } finally {
    evidence("lifecycle.json", log);
    if (agent) await control(admin, "DELETE", `/v1/agents/${agent}`).catch(() => undefined);
    adminRelay.close();
    memberRelay.close();
    await browser.close();
  }
});

test("personas and teams persist, share only explicitly, and project without secrets", async () => {
  const run = `${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
  const baseURL = test.info().project.use.baseURL as string;
  const browser: Browser = await chromium.launch({ env: browserEnvironment() });
  const context = await browser.newContext({
    baseURL,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const adminRelay = await NodeRelayClient.connect(liveRelayUrl(), admin.secretKey);
  const memberRelay = await NodeRelayClient.connect(liveRelayUrl(), member.secretKey);
  const log: Record<string, unknown> = { run };
  const allowlisted = member.pubkey;
  try {
    await importIdentity(page, admin);
    await openAgents(page);
    const tool = page.getByTestId("workspace-tool-agents");
    await tool.getByRole("tab", { name: "Personas" }).click();

    const createPersona = async (name: string, shared: boolean) => {
      await tool.getByRole("button", { name: "New persona" }).click();
      const dialog = page.getByRole("dialog", { name: "New persona" });
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Model").fill(MODEL);
      await dialog.getByLabel("Instructions").fill(`Persona ${name}`);
      await dialog.getByLabel("Responds to").selectOption("allowlist");
      await dialog
        .getByLabel("Allowlisted members (npub or hex, one per line)", { exact: true })
        .fill(nip19.npubEncode(allowlisted));
      if (shared) await dialog.getByLabel(/Share to catalog/).check();
      await dialog.getByRole("button", { name: "Save persona" }).click();
      await expect(dialog).toHaveCount(0);
    };
    await createPersona(`private-${run}`, false);
    await createPersona(`shared-${run}`, true);
    await expect(tool.getByTestId("agent-personas")).toContainText(`shared-${run}`);

    const own = await adminRelay.waitFor(
      [{ kinds: [30175], authors: [admin.pubkey] }],
      (events) => events.filter((event) => event.content.includes(run)).length >= 2,
    );
    const sharedEvent = own.find((event) => event.content.includes(`shared-${run}`));
    const privateEvent = own.find((event) => event.content.includes(`private-${run}`));
    expect(sharedEvent?.tags.filter((tag) => tag[0] === "shared")).toEqual([["shared", "true"]]);
    expect(sharedEvent?.content).not.toContain(allowlisted);
    expect(privateEvent?.tags.some((tag) => tag[0] === "shared")).toBe(false);
    expect(privateEvent?.content).toContain(allowlisted);

    const visibleToMember = await memberRelay.query([{ kinds: [30175], authors: [admin.pubkey] }]);
    expect(visibleToMember.some((event) => event.id === sharedEvent?.id)).toBe(true);
    expect(visibleToMember.some((event) => event.id === privateEvent?.id)).toBe(false);

    // Team with both members, shared → sanitized 30178.
    await tool.getByRole("tab", { name: "Teams" }).click();
    await tool.getByRole("button", { name: "New team" }).click();
    const teamDialog = page.getByRole("dialog", { name: "New team" });
    await teamDialog.getByLabel("Team name").fill(`team-${run}`);
    await teamDialog.getByLabel(`private-${run}`).check();
    await teamDialog.getByLabel(`shared-${run}`).check();
    await teamDialog.getByLabel(/Share to catalog/).check();
    await teamDialog.getByRole("button", { name: "Save team" }).click();
    await expect(teamDialog).toHaveCount(0);
    await expect(tool.getByTestId("agent-teams")).toContainText(`team-${run}`);
    const projection = await memberRelay.waitFor(
      [{ kinds: [30178], authors: [admin.pubkey] }],
      (events) => events.some((event) => event.content.includes(`team-${run}`)),
    );
    const projected = projection.find((event) => event.content.includes(`team-${run}`));
    expect(projected?.content).not.toContain(allowlisted);
    expect(projected?.content).not.toContain("respond_to_allowlist");
    expect(projected?.tags.filter((tag) => tag[0] === "shared")).toEqual([["shared", "true"]]);
    log.catalog = {
      sharedPersonaVisibleToMember: true,
      privatePersonaVisibleToMember: false,
      projectionBytes: projected?.content.length,
    };
    await page.screenshot({ path: path.join(EVIDENCE, "agents-teams-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await tool.getByRole("tab", { name: "Personas" }).click();
    await page.screenshot({ path: path.join(EVIDENCE, "agents-personas-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Cleanup through the UI (NIP-09 deletions of the owner's coordinates).
    await tool.getByRole("tab", { name: "Teams" }).click();
    await tool.getByRole("button", { name: `Delete team team-${run}` }).click();
    await tool.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(tool.getByText(`team-${run}`, { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
    await tool.getByRole("tab", { name: "Personas" }).click();
    for (const name of [`private-${run}`, `shared-${run}`]) {
      await tool.getByRole("button", { name: `Delete ${name}` }).click();
      await tool.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(tool.getByText(name, { exact: true })).toHaveCount(0, { timeout: 30_000 });
    }
  } finally {
    evidence("catalog.json", log);
    adminRelay.close();
    memberRelay.close();
    await browser.close();
  }
});
