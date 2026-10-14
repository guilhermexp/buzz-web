import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { type BrowserContext, expect, firefox, type Page, test } from "@playwright/test";
import type { NostrEvent } from "nostr-tools";
import {
  browserEnvironment,
  identityFromEnvironment,
  importIdentity,
  type LiveIdentity,
  liveRelayUrl,
  openChannel,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";
import {
  addChannelMember,
  archiveChannels,
  createChannel,
  evidenceLog,
  mention,
  openNotificationSettings,
  PUSH_FIREFOX_PREFS,
  publish,
  readWorkerState,
  waitForReceived,
} from "./support-push/push-live";
import {
  type AlertWindow,
  captureScreen,
  clickAlert,
  requireXDisplay,
  visibleAlerts,
  waitForNewAlert,
} from "./support-push/x-alerts";

// Real notification clicks: relay → Web Push → Mozilla autopush → Firefox
// service worker → displayed Firefox alert window → X pointer click on that
// window → Firefox's notificationclick → sw.js opens or focuses the app.
// Nothing posts worker messages or dispatches events into the page.

const EVIDENCE_DIR = resolve(process.env.BUZZ_PUSH_CLICK_EVIDENCE_DIR ?? "../.tmp/push-click");
const evidence = evidenceLog(resolve(EVIDENCE_DIR, "live-push-click-evidence.log"));
const NO_ACCESS = "You can't open that conversation with the current identity.";

/** Firefox's own alert windows (not a system daemon), shown on the Xvfb display. */
const CLICK_FIREFOX_PREFS = {
  ...PUSH_FIREFOX_PREFS,
  "permissions.default.desktop-notification": 1,
  "alerts.useSystemBackend": false,
} as const;

function deepLinkParams(url: string) {
  const params = new URL(url).searchParams;
  return {
    community: params.get("community"),
    channel: params.get("channel"),
    event: params.get("event"),
  };
}

async function unlock(page: Page, identity: LiveIdentity) {
  await page.getByLabel("Vault passphrase").fill(identity.vaultPassphrase);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("button", { name: "Profile menu" })).toBeVisible({
    timeout: 60_000,
  });
}

/** A highlighted, focused row for exactly this event in the open channel. */
async function expectEventRevealed(page: Page, channelName: string, event: NostrEvent) {
  await expect(page.getByRole("heading", { name: channelName, exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const row = page.locator(`article[data-message-id="${event.id}"]`);
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(row).toContainText(event.content.split(" nostr:")[0]);
  await expect(page.locator('article[aria-current="true"]')).toHaveCount(1);
  await expect
    .poll(() => deepLinkParams(page.url()))
    .toEqual({ community: null, channel: null, event: null });
}

/** Nothing from the revoked channel or event rendered anywhere in the page. */
async function expectNoAccess(page: Page, channelName: string, event: NostrEvent) {
  await expect(page.getByText(NO_ACCESS)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: channelName, exact: true })).toHaveCount(0);
  await expect(page.locator(`article[data-message-id="${event.id}"]`)).toHaveCount(0);
  await expect(page.getByText(event.content.split(" nostr:")[0])).toHaveCount(0);
  await expect(page.locator('article[aria-current="true"]')).toHaveCount(0);
  await expect
    .poll(() => deepLinkParams(page.url()))
    .toEqual({ community: null, channel: null, event: null });
}

test("clicking a displayed push notification opens the exact authorized event", async ({
  baseURL,
}) => {
  if (!baseURL) throw new Error("baseURL is required");
  const display = await requireXDisplay();
  const relayUrl = liveRelayUrl();
  const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
  const sender = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const profileDir = resolve(EVIDENCE_DIR, "firefox-profile");
  await rm(profileDir, { recursive: true, force: true });
  const shot = (name: string) => resolve(EVIDENCE_DIR, `${name}.png`);
  await evidence("start", {
    baseURL,
    relayUrl,
    display: process.env.DISPLAY,
    displayGeometry: display,
    browser: "firefox headed (persistent profile), Firefox XUL alert windows",
    firefoxPrefs: CLICK_FIREFOX_PREFS,
  });

  const admin = await NodeRelayClient.connect(relayUrl, sender.secretKey);
  const suffix = Date.now().toString(36);
  const names = {
    closed: `click-closed-${suffix}`,
    open: `click-open-${suffix}`,
    revokedClosed: `click-revoked-closed-${suffix}`,
    revokedOpen: `click-revoked-open-${suffix}`,
  };
  const channels = {
    closed: await createChannel(admin, sender.secretKey, names.closed),
    open: await createChannel(admin, sender.secretKey, names.open),
    revokedClosed: await createChannel(admin, sender.secretKey, names.revokedClosed),
    revokedOpen: await createChannel(admin, sender.secretKey, names.revokedOpen),
  };
  for (const channel of Object.values(channels)) {
    await addChannelMember(admin, sender.secretKey, channel, member.pubkey);
  }
  await evidence("channels-created", { channels, names });

  const removeMember = async (channelId: string) => {
    await publish(admin, sender.secretKey, 9001, [
      ["h", channelId],
      ["p", member.pubkey],
    ]);
    await admin.waitFor([{ kinds: [39002], "#d": [channelId] }], (events) =>
      events.every(
        (event) => !event.tags.some((tag) => tag[0] === "p" && tag[1] === member.pubkey),
      ),
    );
  };

  /**
   * Mention the member and wait for the notification to be on screen: a new
   * alert window under the pointer AND the worker's matching notification.
   */
  const displayMention = async (
    context: BrowserContext,
    step: string,
    channelId: string,
    text: string,
  ) => {
    const known = new Set(await visibleAlerts());
    const event = await mention(admin, sender.secretKey, channelId, member.pubkey, text);
    const alert = await waitForNewAlert(known);
    const state = await waitForReceived(context, baseURL, event.id);
    const entry = state.received.find((candidate) => candidate.event === event.id);
    expect(entry?.shown, "worker displayed the notification").toBe(true);
    const notification = state.notifications.find(
      (candidate) => candidate.tag === `buzz-push-${event.id}`,
    );
    expect(notification, "notification is listed by the registration").toBeTruthy();
    const url = notification?.url ?? "";
    expect(deepLinkParams(url)).toEqual({
      community: relayUrl,
      channel: channelId,
      event: event.id,
    });
    // The pointer is about to click exactly one alert: this one.
    expect(await visibleAlerts()).toEqual([alert.id]);
    await captureScreen(shot(`${step}-notification-displayed`));
    await evidence(`${step}-notification-displayed`, {
      event: event.id,
      channel: channelId,
      alertWindow: alert,
      receivedAt: entry?.receivedAt,
      notification: { title: notification?.title, body: notification?.body, url },
    });
    return { event, alert, url };
  };

  const clickAndOpenNewTab = async (context: BrowserContext, alert: AlertWindow, url: string) => {
    const opened = context.waitForEvent("page", { timeout: 60_000 });
    await clickAlert(alert);
    const page = await opened;
    await page.waitForURL((current) => current.toString() === url, { timeout: 60_000 });
    return page;
  };

  const context = await firefox.launchPersistentContext(profileDir, {
    baseURL,
    headless: false,
    locale: "en-US",
    // A private, nonexistent session bus: Firefox's own alerts need no D-Bus,
    // and the browser must not reach the host user's session services.
    env: { ...browserEnvironment(), DBUS_SESSION_BUS_ADDRESS: "disabled:" },
    viewport: { width: 1440, height: 900 },
    firefoxUserPrefs: CLICK_FIREFOX_PREFS,
  });
  try {
    // Keeps the browser (and its push connection) alive while app tabs are closed.
    const keepAlive = context.pages()[0] ?? (await context.newPage());
    await keepAlive.goto("about:blank");

    const enroll = await context.newPage();
    await importIdentity(enroll, member);
    const section = await openNotificationSettings(enroll);
    await section.getByRole("button", { name: "Turn on notifications" }).click();
    await expect(section.locator("[data-push-status]")).toHaveText("On", { timeout: 60_000 });
    await enroll.close();
    expect((await readWorkerState(context, baseURL)).subscribed).toBe(true);
    await evidence("enrolled");

    // (i) Every app tab closed: the click opens the app at the exact event.
    expect(context.pages().map((page) => page.url())).toEqual(["about:blank"]);
    await evidence("i-app-tabs-closed", { openPages: context.pages().map((page) => page.url()) });
    const first = await displayMention(context, "i", channels.closed, `click closed ${suffix}`);
    const app = await clickAndOpenNewTab(context, first.alert, first.url);
    await evidence("i-clicked-opened-window", { url: app.url(), event: first.event.id });
    await unlock(app, member);
    await expectEventRevealed(app, names.closed, first.event);
    await app.screenshot({ path: shot("i-event-revealed") });
    await captureScreen(shot("i-screen-after-click"));
    await evidence("i-navigated-to-event", {
      channel: channels.closed,
      event: first.event.id,
      finalUrl: app.url(),
    });

    // (ii) App open on another view in a non-selected tab: the click reuses
    // that tab (no new window) and it navigates to the exact event. sw.js then
    // calls WindowClient.focus(); Playwright's Firefox keeps every tab active
    // (all pages report visible/focused), so whether the tab strip switches
    // is not observable here and is not asserted.
    await openNotificationSettings(app);
    await expect(app.getByRole("heading", { name: names.closed, exact: true })).toHaveCount(0);
    await keepAlive.bringToFront();
    const second = await displayMention(context, "ii", channels.open, `click open ${suffix}`);
    const newPages: string[] = [];
    const onPage = (page: Page) => newPages.push(page.url());
    context.on("page", onPage);
    await clickAlert(second.alert);
    await expectEventRevealed(app, names.open, second.event);
    context.off("page", onPage);
    expect(newPages).toEqual([]);
    await app.screenshot({ path: shot("ii-event-revealed") });
    await captureScreen(shot("ii-screen-after-click"));
    await evidence("ii-existing-tab-navigated", {
      channel: channels.open,
      event: second.event.id,
      newWindows: newPages.length,
      finalUrl: app.url(),
    });

    // (iii-a) Removed after display, every app tab closed: the opened app
    // re-checks access and shows nothing from the channel.
    await app.close();
    expect(context.pages().map((page) => page.url())).toEqual(["about:blank"]);
    const third = await displayMention(
      context,
      "iii-a",
      channels.revokedClosed,
      `click revoked closed ${suffix}`,
    );
    await removeMember(channels.revokedClosed);
    const own = await NodeRelayClient.connect(relayUrl, member.secretKey);
    const relayView = await own
      .query([{ ids: [third.event.id], limit: 1 }])
      .then((events) => `${events.length} event(s)`)
      .catch((error: unknown) => `rejected: ${String(error)}`);
    own.close();
    expect(relayView).not.toBe("1 event(s)");
    await evidence("iii-a-member-removed-after-display", {
      channel: channels.revokedClosed,
      relayViewOfEvent: relayView,
    });
    const revokedApp = await clickAndOpenNewTab(context, third.alert, third.url);
    await evidence("iii-a-clicked-opened-window", { url: revokedApp.url() });
    await unlock(revokedApp, member);
    await expectNoAccess(revokedApp, names.revokedClosed, third.event);
    await expect(
      revokedApp.getByRole("button", { name: names.revokedClosed, exact: true }),
    ).toHaveCount(0);
    await revokedApp.screenshot({ path: shot("iii-a-no-access") });
    await captureScreen(shot("iii-a-screen-after-click"));
    await evidence("iii-a-no-access", { channel: channels.revokedClosed, event: third.event.id });

    // (iii-b) Removed after display while an open tab still lists the channel
    // it loaded as a member: that tab asks the Relay again and refuses.
    await expect(revokedApp.getByText(NO_ACCESS)).toHaveCount(0, { timeout: 30_000 });
    await openChannel(revokedApp, names.revokedOpen);
    await openNotificationSettings(revokedApp);
    const fourth = await displayMention(
      context,
      "iii-b",
      channels.revokedOpen,
      `click revoked open ${suffix}`,
    );
    await removeMember(channels.revokedOpen);
    await evidence("iii-b-member-removed-after-display", { channel: channels.revokedOpen });
    const pagesBefore = context.pages().length;
    await clickAlert(fourth.alert);
    await expectNoAccess(revokedApp, names.revokedOpen, fourth.event);
    expect(context.pages()).toHaveLength(pagesBefore);
    await revokedApp.screenshot({ path: shot("iii-b-no-access") });
    await captureScreen(shot("iii-b-screen-after-click"));
    await evidence("iii-b-no-access", { channel: channels.revokedOpen, event: fourth.event.id });

    // Leave no live enrollment behind for this throwaway profile.
    const revoke = await openNotificationSettings(revokedApp);
    await revoke.getByRole("button", { name: "Turn off notifications" }).click();
    await expect(revoke.locator("[data-push-status]")).toHaveText("Off", { timeout: 60_000 });
    await evidence("revoked-enrollment");
  } finally {
    await context.close();
    await archiveChannels(admin, sender.secretKey, Object.values(channels));
    admin.close();
  }
});
