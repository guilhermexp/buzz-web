import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, firefox, test } from "@playwright/test";
import {
  browserEnvironment,
  identityFromEnvironment,
  importIdentity,
  liveRelayUrl,
  openChannel,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";
import {
  addChannelMember,
  archiveChannels,
  createChannel,
  delay,
  evidenceLog,
  mention,
  openNotificationSettings,
  PUSH_FIREFOX_PREFS,
  publish,
  readWorkerState,
  waitForReceived,
} from "./support-push/push-live";

// Real background delivery: relay → RFC 8291/8292 Web Push → Mozilla autopush
// (internet) → Firefox service worker, with every app tab closed.

const EVIDENCE_DIR = resolve(process.env.BUZZ_PUSH_EVIDENCE_DIR ?? "../.tmp/push");
const EVIDENCE_LOG = resolve(EVIDENCE_DIR, "live-push-evidence.log");
const evidence = evidenceLog(EVIDENCE_LOG);

test("background push reaches a closed Firefox tab and opens the exact event", async ({
  baseURL,
}) => {
  if (!baseURL) throw new Error("baseURL is required");
  const relayUrl = liveRelayUrl();
  const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
  const sender = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const profileDir = resolve(EVIDENCE_DIR, "firefox-profile");
  await rm(profileDir, { recursive: true, force: true });
  await evidence("start", { baseURL, relayUrl, browser: "firefox (persistent profile)" });

  const admin = await NodeRelayClient.connect(relayUrl, sender.secretKey);
  const sharedName = `push-shared-${Date.now().toString(36)}`;
  const shared = await createChannel(admin, sender.secretKey, sharedName);
  await addChannelMember(admin, sender.secretKey, shared, member.pubkey);
  const controlName = `push-control-${Date.now().toString(36)}`;
  const controlChannel = await createChannel(admin, sender.secretKey, controlName);
  await addChannelMember(admin, sender.secretKey, controlChannel, member.pubkey);
  const hidden = await createChannel(
    admin,
    sender.secretKey,
    `push-hidden-${Date.now().toString(36)}`,
  );
  await evidence("channels-created", { shared, hidden, memberOnlyIn: "shared" });

  const context = await firefox.launchPersistentContext(profileDir, {
    baseURL,
    locale: "en-US",
    env: browserEnvironment(),
    viewport: { width: 1440, height: 900 },
    firefoxUserPrefs: {
      ...PUSH_FIREFOX_PREFS,
      "permissions.default.desktop-notification": 1,
      // Headless Firefox has no system notification daemon; use Firefox's own alerts.
      "alerts.useSystemBackend": false,
      // BUZZ_PUSH_DEBUG=1 + DEBUG=pw:browser surfaces Firefox's push service log.
      ...(process.env.BUZZ_PUSH_DEBUG
        ? {
            "dom.push.loglevel": "debug",
            "browser.dom.window.dump.enabled": true,
            "devtools.console.stdout.chrome": true,
            "devtools.console.stdout.content": true,
          }
        : {}),
    },
  });
  try {
    // Keep the browser (and its push connection) alive while the app tab is closed.
    const keepAlive = context.pages()[0] ?? (await context.newPage());
    await keepAlive.goto("about:blank");

    const app = await context.newPage();
    await importIdentity(app, member);
    const section = await openNotificationSettings(app);
    await expect(section.locator("[data-push-status]")).toHaveText("Off");
    await app.screenshot({ path: resolve(EVIDENCE_DIR, "settings-notifications-off-desktop.png") });
    await section.getByRole("button", { name: "Turn on notifications" }).click();
    await expect(section.locator("[data-push-status]")).toHaveText("On", { timeout: 60_000 });
    await expect(section.getByRole("checkbox", { name: /Direct messages/ })).toBeChecked();
    await app.screenshot({ path: resolve(EVIDENCE_DIR, "settings-notifications-on-desktop.png") });
    await app.setViewportSize({ width: 390, height: 844 });
    // Narrowing the viewport can leave the mobile navigation drawer open over Settings.
    await app.keyboard.press("Escape");
    await expect(section.getByRole("heading", { name: "Notifications" })).toBeInViewport();
    await app.screenshot({ path: resolve(EVIDENCE_DIR, "settings-notifications-on-mobile.png") });
    await app.setViewportSize({ width: 1440, height: 900 });
    const enrolled = await readWorkerState(context, baseURL);
    expect(enrolled.subscribed).toBe(true);
    await evidence("enrolled", { subscribed: enrolled.subscribed });
    await app.close();
    expect(context.pages().every((page) => page.url() === "about:blank")).toBe(true);
    await evidence("app-tabs-closed", { openPages: context.pages().map((page) => page.url()) });

    // Non-member channel first: the relay must suppress it at match/delivery time.
    const blocked = await mention(admin, sender.secretKey, hidden, member.pubkey, "hidden mention");
    const delivered = await mention(
      admin,
      sender.secretKey,
      shared,
      member.pubkey,
      `push acceptance ${Date.now().toString(36)}`,
    );
    await evidence("events-published", { blocked: blocked.id, delivered: delivered.id });

    const afterDelivery = await waitForReceived(context, baseURL, delivered.id);
    const entry = afterDelivery.received.find((candidate) => candidate.event === delivered.id);
    await evidence("worker-receipt", { entry: entry ?? null });
    expect(entry, "service worker received the push with the app tab closed").toBeTruthy();
    expect(entry?.shown).toBe(true);
    expect(entry?.channel).toBe(shared);
    expect(entry?.kind).toBe(9);
    const notification = afterDelivery.notifications.find(
      (candidate) => candidate.tag === `buzz-push-${delivered.id}`,
    );
    expect(notification, "notification is displayed").toBeTruthy();
    expect(notification?.body).not.toContain("push acceptance");
    const url = new URL(notification?.url ?? "");
    expect(url.searchParams.get("community")).toBe(relayUrl);
    expect(url.searchParams.get("channel")).toBe(shared);
    expect(url.searchParams.get("event")).toBe(delivered.id);
    await evidence("delivered-with-tab-closed", {
      event: delivered.id,
      receivedAt: entry?.receivedAt,
      latencyMs: entry ? entry.receivedAt - delivered.created_at * 1000 : null,
      notification,
    });

    // Give the earlier non-member event ample time; it must never arrive.
    await delay(20_000);
    const afterHidden = await readWorkerState(context, baseURL);
    expect(afterHidden.received.some((candidate) => candidate.event === blocked.id)).toBe(false);
    await evidence("non-member-suppressed", {
      event: blocked.id,
      receivedEvents: afterHidden.received.map((candidate) => candidate.event),
    });

    // Opening the notification URL resolves the exact event after re-checking access.
    const opened = await context.newPage();
    await opened.goto(notification?.url ?? "");
    await opened.getByLabel("Vault passphrase").fill(member.vaultPassphrase);
    await opened.getByRole("button", { name: "Unlock" }).click();
    await expect(opened.getByRole("heading", { name: sharedName, exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(opened.getByText(delivered.content.split(" nostr:")[0])).toBeVisible();
    await expect.poll(() => new URL(opened.url()).searchParams.get("event")).toBeNull();
    await evidence("deep-link-resolved", { channel: shared, event: delivered.id });

    // Click with the app already open: the worker posts {type:"buzz-push-open", url}
    // to the focused tab. This headless run cannot click the displayed alert, so
    // the page receives that exact message on navigator.serviceWorker (the
    // bridge's listener); live-push-click.spec.ts clicks the real alert window.
    await openNotificationSettings(opened);
    await expect(opened.getByRole("heading", { name: sharedName, exact: true })).toBeHidden();
    await opened.evaluate((url) => {
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", { data: { type: "buzz-push-open", url } }),
      );
    }, notification?.url ?? "");
    await expect(opened.getByRole("heading", { name: sharedName, exact: true })).toBeVisible();
    await expect(opened.getByText(delivered.content.split(" nostr:")[0])).toBeVisible();
    await evidence("open-tab-message-resolved", {
      method:
        "dispatched worker message on navigator.serviceWorker (notificationclick not drivable)",
      event: delivered.id,
    });

    // Opt the control channel into all messages, then mute it: the lease is
    // republished; channel-wide traffic stops but mentions still notify
    // (desktop/mobile parity: mention fires before the mute check).
    const prefs = await openNotificationSettings(opened);
    await prefs.getByRole("checkbox", { name: `#${controlName}` }).check();
    await expect(opened.getByText("Notification choices saved")).toBeVisible();
    // Positive control: once opted in, channel-wide traffic is delivered.
    const optedIn = await publish(
      admin,
      sender.secretKey,
      9,
      [["h", controlChannel]],
      "opted-in channel-wide message",
    );
    const afterOptIn = await waitForReceived(context, baseURL, optedIn.id);
    expect(afterOptIn.received.some((candidate) => candidate.event === optedIn.id)).toBe(true);
    await evidence("opted-in-channel-wide-delivered", { event: optedIn.id });
    await opened.keyboard.press("Escape");
    await openChannel(opened, controlName);
    await opened.getByRole("button", { name: "Channel details" }).click();
    const details = opened.getByRole("complementary", { name: "Channel details" });
    await details.getByRole("button", { name: "Mute channel" }).click();
    await expect(details.getByRole("button", { name: "Unmute channel" })).toBeVisible();
    await delay(10_000); // bridge debounce (2s) + NIP-44 lease publish
    await opened.close();
    const plain = await publish(
      admin,
      sender.secretKey,
      9,
      [["h", controlChannel]],
      "muted channel-wide message",
    );
    const mutedMention = await mention(
      admin,
      sender.secretKey,
      controlChannel,
      member.pubkey,
      "mention in muted channel",
    );
    const afterMute = await waitForReceived(context, baseURL, mutedMention.id);
    expect(afterMute.received.some((candidate) => candidate.event === mutedMention.id)).toBe(true);
    await delay(15_000);
    const mutedState = await readWorkerState(context, baseURL);
    expect(mutedState.received.some((candidate) => candidate.event === plain.id)).toBe(false);
    await evidence("muted-channel-drops-channel-wide-keeps-mentions", {
      channelWide: plain.id,
      mention: mutedMention.id,
      receivedEvents: mutedState.received.map((candidate) => candidate.event),
    });

    // Revocation: active:false lease + unsubscribe; later events deliver nothing.
    const settingsPage = await context.newPage();
    await settingsPage.goto("./");
    await settingsPage.getByLabel("Vault passphrase").fill(member.vaultPassphrase);
    await settingsPage.getByRole("button", { name: "Unlock" }).click();
    await expect(settingsPage.getByRole("button", { name: "Profile menu" })).toBeVisible();
    const revokeSection = await openNotificationSettings(settingsPage);
    await revokeSection.getByRole("button", { name: "Turn off notifications" }).click();
    await expect(revokeSection.locator("[data-push-status]")).toHaveText("Off", {
      timeout: 60_000,
    });
    await settingsPage.close();
    const revokedState = await readWorkerState(context, baseURL);
    expect(revokedState.subscribed).toBe(false);
    const afterRevoke = await mention(
      admin,
      sender.secretKey,
      shared,
      member.pubkey,
      "after revoke",
    );
    await delay(60_000);
    const finalState = await readWorkerState(context, baseURL);
    expect(finalState.received.some((candidate) => candidate.event === afterRevoke.id)).toBe(false);
    await evidence("revoked-receives-nothing", {
      event: afterRevoke.id,
      subscribed: finalState.subscribed,
      receivedEvents: finalState.received.map((candidate) => candidate.event),
    });
  } finally {
    await context.close();
    await archiveChannels(admin, sender.secretKey, [shared, controlChannel, hidden]);
    admin.close();
  }
});

test("denied notification permission shows blocked and enrolls nothing", async ({ baseURL }) => {
  if (!baseURL) throw new Error("baseURL is required");
  const relayUrl = liveRelayUrl();
  const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const profileDir = resolve(EVIDENCE_DIR, "firefox-profile-denied");
  await rm(profileDir, { recursive: true, force: true });
  // Lease reads are author-only, so the member's own authenticated view is complete.
  const own = await NodeRelayClient.connect(relayUrl, member.secretKey);
  const leaseFilter = [{ kinds: [30350], authors: [member.pubkey] }];
  const leaseState = async () =>
    (await own.query(leaseFilter)).map((event) => `${event.id}:${event.created_at}`).sort();
  const before = await leaseState();
  await evidence("denied-start", { leasesBefore: before.length });

  const context = await firefox.launchPersistentContext(profileDir, {
    baseURL,
    locale: "en-US",
    env: browserEnvironment(),
    viewport: { width: 1440, height: 900 },
    firefoxUserPrefs: {
      ...PUSH_FIREFOX_PREFS,
      // 2 = block: the same state as a user choosing "Block" for the site.
      "permissions.default.desktop-notification": 2,
    },
  });
  try {
    const app = context.pages()[0] ?? (await context.newPage());
    await importIdentity(app, member);
    expect(await app.evaluate(() => Notification.permission)).toBe("denied");
    const section = await openNotificationSettings(app);
    await expect(section.locator("[data-push-status]")).toHaveText("Blocked");
    await expect(
      section.getByText(
        "Notifications are blocked for this site. Allow them in your browser's site settings, then turn them on here.",
      ),
    ).toBeVisible();
    await expect(section.getByRole("button", { name: "Turn on notifications" })).toHaveCount(0);
    await app.screenshot({
      path: resolve(EVIDENCE_DIR, "settings-notifications-blocked-desktop.png"),
    });
    // Give the background bridge time to (not) act before checking side effects.
    await delay(10_000);
    const state = await readWorkerState(context, baseURL);
    expect(state.subscribed).toBe(false);
    const after = await leaseState();
    expect(after).toEqual(before);
    await evidence("denied-blocked-no-enrollment", {
      permission: "denied",
      status: "Blocked",
      subscribed: state.subscribed,
      leasesBefore: before.length,
      leasesAfter: after.length,
    });
  } finally {
    await context.close();
    own.close();
  }
});
