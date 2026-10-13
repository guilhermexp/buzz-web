import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { type BrowserContext, expect, type Page } from "@playwright/test";
import type { NodeRelayClient } from "../support/node-relay";

/** What the Buzz service worker displayed and recorded, read without an app tab. */
export type SwState = {
  notifications: Array<{ title: string; body: string; tag: string; url: string | null }>;
  received: Array<{
    receivedAt: number;
    origin: string | null;
    channel: string | null;
    event: string | null;
    kind: number | null;
    shown: boolean;
    url: string | null;
    error?: string;
  }>;
  subscribed: boolean;
};

/** Firefox preferences for real Web Push through Mozilla autopush. */
export const PUSH_FIREFOX_PREFS = {
  "dom.push.enabled": true,
  "dom.push.connection.enabled": true,
  "dom.push.serverURL": "wss://push.services.mozilla.com/",
  "dom.serviceWorkers.enabled": true,
  "dom.webnotifications.enabled": true,
} as const;

/** Append timestamped JSON lines to one evidence log. */
export function evidenceLog(path: string) {
  return async (step: string, detail: Record<string, unknown> = {}) => {
    await appendFile(
      path,
      `${JSON.stringify({ at: new Date().toISOString(), step, ...detail })}\n`,
    );
  };
}

export function delay(ms: number): Promise<void> {
  const { promise, resolve: done } = Promise.withResolvers<void>();
  setTimeout(done, ms);
  return promise;
}

/**
 * Read the worker's state from a same-origin document that is NOT the app
 * (the raw sw.js script), so no app tab exists while push is delivered.
 */
export async function readWorkerState(context: BrowserContext, baseURL: string): Promise<SwState> {
  const probe = await context.newPage();
  try {
    await probe.goto(new URL("sw.js", baseURL).toString());
    return await probe.evaluate(async (scope) => {
      const registration = await navigator.serviceWorker.getRegistration(scope);
      const notifications = registration ? await registration.getNotifications() : [];
      const subscription = await registration?.pushManager.getSubscription();
      const received = await new Promise<SwState["received"]>((done, fail) => {
        const open = indexedDB.open("buzz-push", 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore("enrollments", { keyPath: "origin" });
          open.result.createObjectStore("received", { autoIncrement: true });
        };
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction("received").objectStore("received").getAll();
          request.onsuccess = () => {
            open.result.close();
            done(request.result);
          };
          request.onerror = () => fail(request.error);
        };
      });
      return {
        notifications: notifications.map((notification) => ({
          title: notification.title,
          body: notification.body,
          tag: notification.tag,
          url: typeof notification.data?.url === "string" ? notification.data.url : null,
        })),
        received,
        subscribed: Boolean(subscription),
      };
    }, new URL("./", baseURL).pathname);
  } finally {
    await probe.close();
  }
}

export async function waitForReceived(
  context: BrowserContext,
  baseURL: string,
  eventId: string,
  timeoutMs = 180_000,
): Promise<SwState> {
  const deadline = Date.now() + timeoutMs;
  let state = await readWorkerState(context, baseURL);
  while (!state.received.some((entry) => entry.event === eventId) && Date.now() < deadline) {
    await delay(5_000);
    state = await readWorkerState(context, baseURL);
  }
  return state;
}

export async function openNotificationSettings(page: Page) {
  await page.keyboard.press("Control+,");
  const settings = page.getByTestId("workspace-tool-settings");
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Notifications", exact: true }).click();
  return settings.getByRole("region", { name: "Notifications" });
}

/** Publish as the sender, waiting out the shared relay's per-identity rate limit. */
export async function publish(
  admin: NodeRelayClient,
  secretKey: Uint8Array,
  kind: number,
  tags: string[][],
  content = "",
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await admin.publish(
        { kind, created_at: Math.floor(Date.now() / 1000), content, tags },
        secretKey,
      );
    } catch (error) {
      const retry = String(error).match(/rate-limited.*retry in (\d+)s/);
      if (!retry || attempt >= 10) throw error;
      await delay((Number(retry[1]) + 1) * 1000);
    }
  }
}

export async function createChannel(admin: NodeRelayClient, secretKey: Uint8Array, name: string) {
  const id = randomUUID();
  await publish(admin, secretKey, 9007, [
    ["h", id],
    ["name", name],
    ["visibility", "private"],
    ["channel_type", "stream"],
    ["about", "Automated push acceptance; safe to archive."],
  ]);
  return id;
}

export async function addChannelMember(
  admin: NodeRelayClient,
  secretKey: Uint8Array,
  channelId: string,
  pubkey: string,
) {
  await publish(admin, secretKey, 9000, [
    ["h", channelId],
    ["p", pubkey],
    ["role", "member"],
  ]);
}

export async function mention(
  admin: NodeRelayClient,
  secretKey: Uint8Array,
  channelId: string,
  pubkey: string,
  text: string,
) {
  return publish(
    admin,
    secretKey,
    9,
    [
      ["h", channelId],
      ["p", pubkey],
    ],
    `${text} nostr:${pubkey}`,
  );
}

export async function archiveChannels(
  admin: NodeRelayClient,
  secretKey: Uint8Array,
  channels: string[],
) {
  for (const channel of channels) {
    await publish(admin, secretKey, 9002, [
      ["h", channel],
      ["archived", "true"],
    ]).catch(() => undefined);
  }
}
