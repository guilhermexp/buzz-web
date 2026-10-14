import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type Browser, chromium, expect, type Page, type Response, test } from "@playwright/test";
import type { NostrEvent } from "nostr-tools/pure";
import {
  addMember,
  archiveChannel,
  browserEnvironment,
  createPrivateChannel,
  identityFromEnvironment,
  importIdentity,
  liveRelayUrl,
  openChannel,
  reloadAndUnlock,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";
import { MISSING_KLIPY_KEY, relayAdvertisesGif } from "./support-gif/relay-gif";

/**
 * Relay-proxied KLIPY GIF search (docs/gif-search.md).
 *
 * - The success path needs real provider results, so it runs only when the Relay advertises
 *   `buzz-gif` AND the operator sets BUZZ_LIVE_GIF_EXPECT_RESULTS=1 after configuring an
 *   operator-approved KLIPY test key. Otherwise it is skipped with the missing prerequisite.
 * - The provider-failure path runs against a Relay deliberately configured with an invalid
 *   placeholder key; BUZZ_LIVE_GIF_EXPECT_ERROR_STATUS names the status that Relay returns.
 *
 * BUZZ_LIVE_SCREENSHOT_DIR (optional) receives screenshots and a JSON evidence log.
 */

const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
const screenshotDir = process.env.BUZZ_LIVE_SCREENSHOT_DIR?.trim();
const expectResults = process.env.BUZZ_LIVE_GIF_EXPECT_RESULTS === "1";
const expectedErrorStatus = Number(process.env.BUZZ_LIVE_GIF_EXPECT_ERROR_STATUS ?? "");

/** Localized copy the Web client shows for each status the Relay's GIF proxy can return. */
const statusCopy: Record<number, { en: string; zh: string }> = {
  401: {
    en: "The Relay could not verify your signed GIF request. Sign in again and retry.",
    zh: "Relay 无法验证你签名的 GIF 请求，请重新登录后重试。",
  },
  404: { en: "GIF search is not configured on this Relay.", zh: "此 Relay 未配置 GIF 搜索。" },
  429: { en: "Too many GIF searches. Try again shortly.", zh: "GIF 搜索过于频繁，请稍后再试。" },
  502: {
    en: "The GIF provider is unavailable or rejected the request. Try again later.",
    zh: "GIF 服务不可用或拒绝了该请求，请稍后再试。",
  },
  503: {
    en: "GIF search is temporarily unavailable on this Relay. Try again later.",
    zh: "此 Relay 的 GIF 搜索暂时不可用，请稍后再试。",
  },
};

const now = () => Math.floor(Date.now() / 1000);
const runId = () => `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function launch(baseURL: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ env: browserEnvironment() });
  const context = await browser.newContext({
    baseURL,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });
  return { browser, page: await context.newPage() };
}

async function capture(page: Page, name: string) {
  if (!screenshotDir) return;
  await page.screenshot({ path: path.join(screenshotDir, name), animations: "disabled" });
}

async function writeEvidence(name: string, value: unknown) {
  if (!screenshotDir) return;
  await writeFile(path.join(screenshotDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

const isGifRequest = (response: Response, endpoint: "search" | "share") =>
  response.request().method() === "POST" &&
  new URL(response.url()).pathname === `/gifs/${endpoint}`;

/** A string field of the JSON body the Web client posted to the Relay's GIF endpoint. */
function postedField(response: Response, field: string): string | undefined {
  const body: unknown = response.request().postDataJSON();
  const entries = body && typeof body === "object" ? Object.entries(body) : [];
  const value = entries.find(([key]) => key === field)?.[1];
  return typeof value === "string" ? value : undefined;
}

const isCatSearch = (response: Response) =>
  isGifRequest(response, "search") && postedField(response, "query") === "cat";

function baseUrl(): string {
  const baseURL = test.info().project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Live base URL is unavailable.");
  return baseURL;
}

test("GIF search surfaces a Relay provider failure in en and zh-CN without sending", async () => {
  const relayUrl = liveRelayUrl();
  const advertised = await relayAdvertisesGif(relayUrl);
  test.skip(
    !advertised || !Number.isInteger(expectedErrorStatus),
    "Provider-failure path needs a Relay advertising buzz-gif with a deliberately invalid " +
      "placeholder key and BUZZ_LIVE_GIF_EXPECT_ERROR_STATUS set to the status it returns.",
  );
  const copy = statusCopy[expectedErrorStatus];
  if (!copy) throw new Error(`No localized copy is defined for status ${expectedErrorStatus}.`);
  const channelName = `web-gif-error-${runId()}`;
  const startedAt = now() - 5;
  const { browser, page } = await launch(baseUrl());
  const uploads: string[] = [];
  const searches: { status: number; query: string }[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/upload") {
      uploads.push(request.url());
    }
  });
  page.on("response", (response) => {
    if (!isGifRequest(response, "search")) return;
    searches.push({ status: response.status(), query: postedField(response, "query") ?? "" });
  });
  let channelCreated = false;
  const shown: Record<string, string> = {};

  try {
    await importIdentity(page, admin);
    await createPrivateChannel(page, channelName);
    channelCreated = true;
    const composer = page.getByRole("textbox", { name: `Send a message to #${channelName}` });

    // English: trending loads on open, then a typed search; both surface the mapped failure.
    const trending = page.waitForResponse((response) => isGifRequest(response, "search"));
    await page.getByRole("button", { name: "Insert emoji or GIF", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Emoji and GIFs" });
    await picker.getByRole("tab", { name: "GIFs" }).click();
    await expect(picker.getByLabel("Search GIFs")).toBeVisible();
    expect((await trending).status()).toBe(expectedErrorStatus);
    const alert = picker.getByRole("alert");
    const enPattern = new RegExp(`^${escapeRegExp(copy.en)} \\(${expectedErrorStatus}[:)]`);
    await expect(alert).toHaveText(enPattern);
    const searched = page.waitForResponse(isCatSearch);
    await picker.getByLabel("Search GIFs").fill("cat");
    expect((await searched).status()).toBe(expectedErrorStatus);
    await expect(alert).toHaveText(enPattern);
    shown.en = (await alert.textContent()) ?? "";
    await expect(picker.getByRole("button", { name: /^Add GIF: / })).toHaveCount(0);
    await capture(page, "gif-error-en.png");
    await page.keyboard.press("Escape");
    await expect(composer).toHaveText("");
    await expect(page.getByTestId("composer-attachments")).toHaveCount(0);

    // Simplified Chinese: the same failure in the browser's first preferred language.
    await page.context().addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "language", { get: () => "zh-CN" });
      Object.defineProperty(Navigator.prototype, "languages", { get: () => ["zh-CN"] });
    });
    await page.reload();
    await page.getByLabel("保险库口令").fill(admin.vaultPassphrase);
    await page.getByRole("button", { name: "解锁" }).click();
    await expect(page.getByRole("button", { name: "个人菜单" })).toBeVisible();
    await openChannel(page, channelName);
    const zhTrending = page.waitForResponse((response) => isGifRequest(response, "search"));
    await page.getByRole("button", { name: "插入表情或 GIF", exact: true }).click();
    const zhPicker = page.getByRole("dialog", { name: "表情和 GIF" });
    await zhPicker.getByRole("tab", { name: "GIF", exact: true }).click();
    await expect(zhPicker.getByLabel("搜索 GIF")).toBeVisible();
    expect((await zhTrending).status()).toBe(expectedErrorStatus);
    await expect(zhPicker.getByRole("alert")).toHaveText(
      new RegExp(`^${escapeRegExp(copy.zh)} \\(${expectedErrorStatus}[:)]`),
    );
    shown["zh-CN"] = (await zhPicker.getByRole("alert").textContent()) ?? "";
    await capture(page, "gif-error-zh-CN.png");
    await page.keyboard.press("Escape");

    // Nothing reached the Relay as a message and nothing was uploaded.
    const reader = await NodeRelayClient.connect(relayUrl, admin.secretKey);
    let sent: NostrEvent[];
    try {
      sent = await reader.query([{ kinds: [9], authors: [admin.pubkey], since: startedAt }]);
    } finally {
      reader.close();
    }
    expect(sent).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    await writeEvidence("gif-error-evidence.json", {
      relayUrl,
      advertised,
      searches,
      shown,
      messagesSent: sent.length,
      uploads: uploads.length,
    });
  } finally {
    if (channelCreated) await archiveChannel(page, channelName).catch(() => undefined);
    await browser.close();
  }
});

test("GIF search selects a KLIPY result, reports the share and sends its CDN URL", async () => {
  const relayUrl = liveRelayUrl();
  const advertised = await relayAdvertisesGif(relayUrl);
  test.skip(
    !advertised || !expectResults,
    `${MISSING_KLIPY_KEY} (${[
      advertised ? null : "Relay NIP-11 does not advertise buzz-gif",
      expectResults ? null : "BUZZ_LIVE_GIF_EXPECT_RESULTS=1 is not set",
    ]
      .filter(Boolean)
      .join("; ")}).`,
  );
  const id = runId();
  const channelName = `web-gif-${id}`;
  const caption = `gif ${id}`;
  const startedAt = now() - 5;
  const adminClient = await launch(baseUrl());
  const memberClient = await launch(baseUrl());
  const adminPage = adminClient.page;
  const memberPage = memberClient.page;
  const uploads: string[] = [];
  adminPage.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/upload") {
      uploads.push(request.url());
    }
  });
  let channelCreated = false;

  try {
    await importIdentity(adminPage, admin);
    await importIdentity(memberPage, member);
    await createPrivateChannel(adminPage, channelName);
    channelCreated = true;
    await addMember(adminPage, member.pubkey);
    await reloadAndUnlock(memberPage, member);
    await openChannel(memberPage, channelName);
    await reloadAndUnlock(adminPage, admin);
    await openChannel(adminPage, channelName);
    const composer = adminPage.getByRole("textbox", { name: `Send a message to #${channelName}` });

    await adminPage.getByRole("button", { name: "Insert emoji or GIF", exact: true }).click();
    const picker = adminPage.getByRole("dialog", { name: "Emoji and GIFs" });
    await picker.getByRole("tab", { name: "GIFs" }).click();
    const searched = adminPage.waitForResponse(isCatSearch);
    await picker.getByLabel("Search GIFs").fill("cat");
    const searchResponse = await searched;
    expect(searchResponse.status()).toBe(200);
    const customerId = postedField(searchResponse, "customer_id");
    expect(postedField(searchResponse, "locale")).toBe("en-US");
    expect(customerId).toMatch(/^[0-9a-f-]{36}$/);
    const firstResult = picker.getByRole("button", { name: /^Add GIF: / }).first();
    await expect(firstResult).toBeVisible({ timeout: 30_000 });
    await capture(adminPage, "gif-results.png");

    // Selecting reports the share (best effort, 204 from the Relay) and attaches the URL.
    const shared = adminPage.waitForResponse((response) => isGifRequest(response, "share"));
    await firstResult.click();
    const shareResponse = await shared;
    expect(shareResponse.status()).toBe(204);
    expect(postedField(shareResponse, "slug")).toBeTruthy();
    expect(postedField(shareResponse, "customer_id")).toBe(customerId);
    await expect(adminPage.getByTestId("composer-attachments")).toContainText(".gif");

    await composer.click();
    await adminPage.keyboard.type(caption);
    await composer.press("Enter");
    await expect(composer).toHaveText("");

    const reader = await NodeRelayClient.connect(relayUrl, member.secretKey);
    let events: NostrEvent[];
    try {
      events = await reader.waitFor(
        [{ kinds: [9], authors: [admin.pubkey], since: startedAt }],
        (found) => found.some((event) => event.content.startsWith(caption)),
      );
    } finally {
      reader.close();
    }
    const sent = events.find((event) => event.content.startsWith(caption));
    const gifUrl = sent?.content.match(/\n\n!\[[^\]]+\.gif\]\((https:\/\/[^)\s]+)\)$/)?.[1];
    expect(gifUrl, "message body carries the provider GIF URL").toBeTruthy();
    const host = new URL(gifUrl ?? "").hostname;
    expect(host === "klipy.com" || host.endsWith(".klipy.com"), `KLIPY CDN host: ${host}`).toBe(
      true,
    );
    expect(sent?.tags.some((tag) => tag[0] === "imeta")).toBe(false);
    expect(uploads).toHaveLength(0);

    // The second browser renders the provider-hosted image through the normal image path.
    const received = memberPage.locator("article").filter({ hasText: caption });
    await expect(received).toHaveCount(1, { timeout: 30_000 });
    await expect(received.locator(`img[src="${gifUrl}"]`)).toBeVisible({ timeout: 30_000 });
    await capture(memberPage, "gif-received.png");
    await writeEvidence("gif-success-evidence.json", {
      relayUrl,
      gifHost: host,
      shareStatus: shareResponse.status(),
      imeta: false,
      uploads: uploads.length,
    });
  } finally {
    if (channelCreated) await archiveChannel(adminPage, channelName).catch(() => undefined);
    await adminClient.browser.close();
    await memberClient.browser.close();
  }
});
