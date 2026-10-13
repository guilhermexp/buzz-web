import { randomBytes } from "node:crypto";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  archiveChannel,
  createPrivateChannel,
  identityFromEnvironment,
  importIdentity,
  openChannel,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

/**
 * Multi-community isolation against two real, separate Relays (separate
 * databases). The deployment's config.json declares community A as its Relay
 * and community B as a preset; the identity is a member of both.
 */
const relayA = (process.env.BUZZ_LIVE_RELAY_URL ?? "ws://127.0.0.1:47300").replace(/\/$/, "");
const relayB = (process.env.BUZZ_LIVE_RELAY_B_URL ?? "ws://127.0.0.1:47320").replace(/\/$/, "");
const communityB = process.env.BUZZ_LIVE_COMMUNITY_B_NAME ?? "Community B";
const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
// Admin of community B; it provisions a throwaway channel there for `admin`.
const adminB = identityFromEnvironment("BUZZ_LIVE_SECOND_ADMIN_NSEC");

type SocketLog = { url: string; sentAt: number[]; closedAt: number | null };

function trackSockets(page: Page): SocketLog[] {
  const sockets: SocketLog[] = [];
  page.on("websocket", (socket) => {
    const log: SocketLog = { url: socket.url().replace(/\/$/, ""), sentAt: [], closedAt: null };
    sockets.push(log);
    socket.on("framesent", () => log.sentAt.push(Date.now()));
    socket.on("close", () => {
      log.closedAt = Date.now();
    });
  });
  return sockets;
}

function framesSentAfter(sockets: SocketLog[], relay: string, since: number): number {
  return sockets
    .filter((socket) => socket.url === relay)
    .reduce((count, socket) => count + socket.sentAt.filter((at) => at > since).length, 0);
}

async function composerText(composer: Locator): Promise<string> {
  return composer.evaluate((element) =>
    element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
      ? element.value
      : (element.textContent ?? ""),
  );
}

async function expectConnectedTo(page: Page, relayUrl: string) {
  await page.keyboard.press("Control+,");
  const settings = page.getByTestId("workspace-tool-settings");
  await settings.getByRole("button", { name: "Identity", exact: true }).click();
  const value = (term: string) =>
    settings.locator("dt").filter({ hasText: term }).locator("xpath=following-sibling::dd[1]");
  await expect(value("Address")).toHaveText(relayUrl);
  await expect(value("Status")).toHaveText("Connected", { timeout: 30_000 });
  await settings.getByRole("button", { name: "Back", exact: true }).click();
}

async function switchCommunity(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Communities" }).getByRole("button", { name }).click();
  await expect(
    page.getByRole("navigation", { name: "Communities" }).getByRole("button", { name }),
  ).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "Profile menu" })).toBeVisible();
}

test("saved communities keep drafts, channels, profiles and traffic isolated", async ({
  browser,
}) => {
  const runId = randomBytes(4).toString("hex");
  const channelName = `uishell-iso-${runId}`;
  const channelBName = `uishell-iso-b-${runId}`;
  const channelBId = crypto.randomUUID();
  const relayBAdmin = await NodeRelayClient.connect(relayB, adminB.secretKey);
  await relayBAdmin.publish(
    {
      kind: 9007,
      created_at: Math.floor(Date.now() / 1_000),
      content: "",
      tags: [
        ["h", channelBId],
        ["name", channelBName],
        ["visibility", "private"],
        ["channel_type", "stream"],
      ],
    },
    adminB.secretKey,
  );
  await relayBAdmin.publish(
    {
      kind: 9000,
      created_at: Math.floor(Date.now() / 1_000),
      content: "",
      tags: [
        ["h", channelBId],
        ["p", admin.pubkey],
      ],
    },
    adminB.secretKey,
  );
  const draftA = `draft only in community A ${runId}`;
  const draftB = `draft only in community B ${runId}`;
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const sockets = trackSockets(page);
  let channelCreated = false;

  try {
    await importIdentity(page, admin);
    await expectConnectedTo(page, relayA);
    await createPrivateChannel(page, channelName);
    channelCreated = true;
    const composerA = page.getByLabel(`Send a message to #${channelName}`);
    await composerA.click();
    await page.keyboard.type(draftA);
    await expect.poll(() => composerText(composerA)).toContain(draftA);
    // Draft persistence is debounced by the composer; give it a moment to land.
    await page.waitForTimeout(1_500);

    const leftA = Date.now();
    await switchCommunity(page, communityB);
    await expectConnectedTo(page, relayB);
    await expect(page.getByRole("button", { name: channelName, exact: true })).toHaveCount(0);
    await expect(page.getByText(draftA)).toHaveCount(0);
    // B's channel has its own, empty draft.
    await openChannel(page, channelBName);
    const composerB = page.getByLabel(`Send a message to #${channelBName}`);
    await expect.poll(() => composerText(composerB)).not.toContain(draftA);
    await composerB.click();
    await page.keyboard.type(draftB);
    await page.waitForTimeout(1_500);
    // Community A's sockets are closed and carry no traffic once B is active.
    await page.waitForTimeout(3_000);
    console.log(
      "community A sockets",
      JSON.stringify(
        sockets
          .filter((socket) => socket.url === relayA)
          .map((socket) => ({ frames: socket.sentAt.length, closed: socket.closedAt !== null })),
      ),
    );
    expect(framesSentAfter(sockets, relayA, leftA + 1_000)).toBe(0);
    expect(
      sockets.filter((socket) => socket.url === relayA).every((s) => s.closedAt !== null),
    ).toBe(true);
    expect(sockets.some((socket) => socket.url === relayB)).toBe(true);

    const leftB = Date.now();
    await switchCommunity(page, "Buzz parity");
    await expectConnectedTo(page, relayA);
    await openChannel(page, channelName);
    const restoredA = page.getByLabel(`Send a message to #${channelName}`);
    await expect.poll(() => composerText(restoredA)).toContain(draftA);
    await expect(page.getByText(draftB)).toHaveCount(0);
    await page.waitForTimeout(3_000);
    expect(framesSentAfter(sockets, relayB, leftB + 1_000)).toBe(0);

    // Scoped storage: each draft lives only under its own Relay's key.
    const storage = await page.evaluate(() =>
      Object.entries(localStorage).filter(([key]) => key.startsWith("buzz:web:draft:")),
    );
    const keyFor = (draft: string) =>
      storage.filter(([, value]) => value.includes(draft)).map(([key]) => key);
    expect(keyFor(draftA).length).toBeGreaterThan(0);
    expect(keyFor(draftB).length).toBeGreaterThan(0);
    expect(keyFor(draftA).every((key) => key.includes(encodeURIComponent(relayA)))).toBe(true);
    expect(keyFor(draftB).every((key) => key.includes(encodeURIComponent(relayB)))).toBe(true);

    // Clear the throwaway drafts before archiving.
    await restoredA.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
  } finally {
    if (channelCreated) await archiveChannel(page, channelName).catch(() => undefined);
    await relayBAdmin
      .publish(
        {
          kind: 9002,
          created_at: Math.floor(Date.now() / 1_000),
          content: "",
          tags: [
            ["h", channelBId],
            ["archived", "true"],
          ],
        },
        adminB.secretKey,
      )
      .catch(() => undefined);
    relayBAdmin.close();
    await context.close();
  }
});
