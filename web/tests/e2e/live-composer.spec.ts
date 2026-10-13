import { randomBytes } from "node:crypto";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { type Browser, chromium, expect, type Locator, type Page, test } from "@playwright/test";
import { generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
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

const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
const screenshotDir = process.env.BUZZ_LIVE_SCREENSHOT_DIR?.trim();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A real 24×16 RGB PNG so the browser sanitizer decodes and re-encodes it. */
function testPng(): Buffer {
  const width = 24;
  const height = 16;
  const chunk = (kind: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(kind, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) rows.push(x * 10, 120, y * 15);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function pasteFile(editor: Locator, name: string, type: string, bytes: Buffer) {
  await editor.evaluate(
    (element, file) => {
      const data = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], file.name, { type: file.type }));
      element.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { base64: bytes.toString("base64"), name, type },
  );
}

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

const now = () => Math.floor(Date.now() / 1000);

/**
 * Two throwaway community members sharing one display name (the ambiguous-mention edit).
 * Their keys only sign their profiles and are wiped right after; nothing is logged.
 */
async function addNamesakes(relayUrl: string, name: string): Promise<string[]> {
  const keys = [generateSecretKey(), generateSecretKey()];
  const pubkeys = keys.map((key) => getPublicKey(key));
  const relayAdmin = await NodeRelayClient.connect(relayUrl, admin.secretKey);
  try {
    for (const pubkey of pubkeys) {
      const tags = [
        ["p", pubkey],
        ["role", "member"],
      ];
      await relayAdmin.publish(
        { kind: 9030, created_at: now(), content: "", tags },
        admin.secretKey,
      );
    }
  } finally {
    relayAdmin.close();
  }
  for (const key of keys) {
    const client = await NodeRelayClient.connect(relayUrl, key);
    try {
      const content = JSON.stringify({ name, display_name: name });
      await client.publish({ kind: 0, created_at: now(), content, tags: [] }, key);
    } finally {
      client.close();
      key.fill(0);
    }
  }
  return pubkeys;
}

async function removeFromCommunity(relayUrl: string, pubkeys: string[]) {
  const relayAdmin = await NodeRelayClient.connect(relayUrl, admin.secretKey);
  try {
    for (const pubkey of pubkeys) {
      const tags = [["p", pubkey]];
      await relayAdmin.publish(
        { kind: 9031, created_at: now(), content: "", tags },
        admin.secretKey,
      );
    }
  } finally {
    relayAdmin.close();
  }
}

/** Read relay state as the member, on a short-lived connection per check. */
async function relayWaitFor(
  relayUrl: string,
  filters: Parameters<NodeRelayClient["query"]>[0],
  predicate: (events: NostrEvent[]) => boolean,
): Promise<NostrEvent[]> {
  const reader = await NodeRelayClient.connect(relayUrl, member.secretKey);
  try {
    return await reader.waitFor(filters, predicate);
  } finally {
    reader.close();
  }
}

const ownEmojiSet = [{ kinds: [30030], authors: [admin.pubkey], "#d": ["buzz:custom-emoji"] }];

/** Failure cleanup: drop this run's shortcode from the admin's own emoji set if still there. */
async function removeOwnEmoji(relayUrl: string, shortcode: string) {
  const client = await NodeRelayClient.connect(relayUrl, admin.secretKey);
  try {
    const [latest] = (await client.query(ownEmojiSet)).sort(
      (left, right) => right.created_at - left.created_at,
    );
    const isRunEmoji = (tag: string[]) => tag[0] === "emoji" && tag[1] === shortcode;
    if (!latest?.tags.some(isRunEmoji)) return;
    const tags = latest.tags.filter((tag) => !isRunEmoji(tag));
    await client.publish({ kind: 30030, created_at: now(), content: "", tags }, admin.secretKey);
  } finally {
    client.close();
  }
}

test("rich composer publishes formatting, mentions, media and custom emoji", async () => {
  const baseURL = test.info().project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Live base URL is unavailable.");
  const relayUrl = liveRelayUrl();
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const channelName = `web-composer-${runId}`;
  const shortcode = `web_${runId.replace(/-/g, "_")}`;
  const startedAt = now() - 5;
  const adminClient = await launch(baseURL);
  const memberClient = await launch(baseURL);
  const adminPage = adminClient.page;
  const memberPage = memberClient.page;
  const uploads: string[] = [];
  adminPage.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/upload") {
      uploads.push(request.url());
    }
  });
  let channelCreated = false;
  let namesakes: string[] = [];

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
    const sendButton = adminPage.getByRole("button", { name: "Send message" });
    await composer.click();

    // Invalid media is rejected locally with a localized reason and never uploaded.
    await pasteFile(composer, "camera.heic", "image/heic", Buffer.from([0, 0, 0, 20]));
    await expect(
      adminPage.getByText("This media format isn't supported for upload."),
    ).toBeVisible();
    expect(uploads).toHaveLength(0);
    await adminPage.getByRole("button", { name: "Dismiss" }).click();

    // Unicode emoji insert; GIF search is honestly unavailable when the Relay has no provider.
    await adminPage.getByRole("button", { name: "Insert emoji" }).click();
    const picker = adminPage.getByRole("dialog", { name: "Emoji and GIFs" });
    await picker.getByRole("tab", { name: "Emoji", exact: true }).click();
    await picker.getByLabel("Search emoji").fill("rocket");
    await picker.getByRole("button", { name: "Rocket", exact: true }).click();
    await expect(composer).toHaveText("🚀");
    await adminPage.getByRole("button", { name: "Insert emoji" }).click();
    await picker.getByRole("tab", { name: "GIFs" }).click();
    await expect(picker.getByText(/GIF search is not available on this Relay/)).toBeVisible();
    await adminPage.keyboard.press("Escape");
    await composer.click();
    await adminPage.keyboard.press("ControlOrMeta+a");
    await adminPage.keyboard.press("Backspace");

    // Formatting through the toolbar, keyboard shortcuts and Markdown input rules.
    await adminPage.getByRole("button", { name: "Toggle formatting" }).click();
    await composer.click();
    await adminPage.keyboard.type("Release ");
    await adminPage.getByRole("button", { name: "Bold", exact: true }).click();
    await adminPage.keyboard.type("ready");
    await adminPage.getByRole("button", { name: "Bold", exact: true }).click();
    await adminPage.keyboard.type(" ");
    await adminPage.keyboard.press("ControlOrMeta+i");
    await adminPage.keyboard.type("today");
    await adminPage.keyboard.press("ControlOrMeta+i");
    await adminPage.keyboard.type(" ~~old~~ run `make ship` see notes");
    for (let step = 0; step < "notes".length; step += 1) {
      await adminPage.keyboard.press("Shift+ArrowLeft");
    }
    // ProseMirror reads the DOM selection on selectionchange; give it a human-scale beat.
    await adminPage.waitForTimeout(150);
    await adminPage.keyboard.press("ControlOrMeta+k");
    await adminPage.getByLabel("Link URL").fill("buzz.example.com/notes");
    await adminPage.getByRole("button", { name: "Apply link" }).click();
    await composer.press("End");
    await adminPage.keyboard.type(" cc @");
    const option = adminPage.locator(`[role="option"][id$="-${member.pubkey}"]`);
    await expect(option).toBeVisible();
    await option.click();
    await pasteFile(composer, "image.png", "image/png", testPng());
    await expect(adminPage.getByRole("button", { name: "Remove attachment" })).toBeVisible({
      timeout: 30_000,
    });
    expect(uploads).toHaveLength(1);
    await capture(adminPage, "composer-desktop-formatted.png");

    // Reload before sending: the formatted draft and its mention binding come back, and
    // moving the caret to the end of the restored mention must not reopen the picker.
    await adminPage.waitForTimeout(400);
    await reloadAndUnlock(adminPage, admin);
    await openChannel(adminPage, channelName);
    await expect(composer.locator("strong")).toHaveText("ready");
    await expect(adminPage.getByTestId("composer-attachments")).toContainText(/pasted-\d+\.png/);
    await expect(sendButton).toBeEnabled();
    await composer.press("End");
    await expect(adminPage.locator(`[role="option"][id$="-${member.pubkey}"]`)).toHaveCount(0);
    await composer.press("Enter");
    await expect(composer).toHaveText("");
    await expect(adminPage.getByTestId("composer-attachments")).toHaveCount(0);

    const events = await relayWaitFor(
      relayUrl,
      [{ kinds: [9], authors: [admin.pubkey], since: startedAt }],
      (found) => found.some((event) => event.content.startsWith("Release **ready**")),
    );
    const sent = events.find((event) => event.content.startsWith("Release **ready**"));
    expect(sent?.content).toMatch(
      /^Release \*\*ready\*\* \*today\* ~~old~~ run `make ship` see \[notes\]\(https:\/\/buzz\.example\.com\/notes\) cc @.+\n\n!\[pasted-\d+\.png\]\(.+\/media\/.+\)$/s,
    );
    expect(sent?.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1])).toEqual([
      member.pubkey,
    ]);
    const imeta = sent?.tags.find((tag) => tag[0] === "imeta") ?? [];
    expect(imeta).toEqual(expect.arrayContaining([expect.stringMatching(/^m image\/png$/)]));
    expect(imeta).toEqual(expect.arrayContaining([expect.stringMatching(/^x [0-9a-f]{64}$/)]));

    // The second browser renders the same formatting, mention chip and protected image.
    const received = memberPage.locator("article").filter({ hasText: "Release" });
    await expect(received).toHaveCount(1, { timeout: 30_000 });
    const body = received.locator(".buzz-message-markdown");
    await expect(body.locator("strong")).toHaveText("ready");
    await expect(body.locator("em")).toHaveText("today");
    await expect(body.locator("del")).toHaveText("old");
    await expect(body.locator("code")).toHaveText("make ship");
    await expect(body.locator('a[href="https://buzz.example.com/notes"]')).toBeVisible();
    await expect(body.locator(`[data-mention-pubkey="${member.pubkey}"]`)).toBeVisible();
    await expect(received.locator('img[src^="blob:"]')).toBeVisible({ timeout: 30_000 });
    await capture(memberPage, "composer-desktop-received.png");

    // Custom emoji: upload into the admin's own kind 30030 set (read-modify-write), send it
    // with its NIP-30 tag, render it in the second browser, then remove it from the set.
    await adminPage.getByRole("button", { name: "Insert emoji" }).click();
    await picker.getByRole("tab", { name: "My emoji" }).click();
    await picker.getByLabel("Emoji image").setInputFiles({
      name: "party.png",
      mimeType: "image/png",
      buffer: testPng(),
    });
    await picker.getByLabel("Emoji name").fill(shortcode);
    await picker.getByRole("button", { name: "Add emoji" }).click();
    await expect(picker.getByRole("status")).toHaveText(`Added :${shortcode}:`, {
      timeout: 30_000,
    });
    expect(uploads).toHaveLength(2);
    await capture(adminPage, "composer-desktop-custom-emoji.png");
    const hasShortcode = (found: NostrEvent[]) =>
      found.some((event) => event.tags.some((tag) => tag[0] === "emoji" && tag[1] === shortcode));
    await relayWaitFor(relayUrl, ownEmojiSet, hasShortcode);
    await picker.getByRole("tab", { name: "Emoji", exact: true }).click();
    await picker.getByRole("button", { name: `:${shortcode}:`, exact: true }).click();
    await expect(composer).toHaveText(`:${shortcode}:`);
    await composer.press("End");
    await adminPage.keyboard.type(" shipped");
    await composer.press("Enter");
    await expect(composer).toHaveText("");
    const emojiEvents = await relayWaitFor(
      relayUrl,
      [{ kinds: [9], authors: [admin.pubkey], since: startedAt }],
      (found) => found.some((event) => event.content === `:${shortcode}: shipped`),
    );
    const emojiTag = emojiEvents
      .find((event) => event.content === `:${shortcode}: shipped`)
      ?.tags.find((tag) => tag[0] === "emoji");
    expect(emojiTag?.slice(0, 2)).toEqual(["emoji", shortcode]);
    expect(emojiTag?.[2]).toMatch(/\/media\//);
    const emojiMessage = memberPage.locator("article").filter({ hasText: "shipped" });
    await expect(
      emojiMessage.locator(`img[data-custom-emoji][data-shortcode="${shortcode}"]`),
    ).toBeVisible({ timeout: 30_000 });
    await capture(memberPage, "composer-desktop-custom-emoji-received.png");
    // The community palette is live: the member is offered the new emoji without a reload.
    await memberPage.getByRole("button", { name: "Insert emoji" }).click();
    const memberPicker = memberPage.getByRole("dialog", { name: "Emoji and GIFs" });
    await memberPicker.getByRole("tab", { name: "Emoji", exact: true }).click();
    await expect(
      memberPicker.getByRole("button", { name: `:${shortcode}:`, exact: true }),
    ).toBeVisible();
    await memberPage.keyboard.press("Escape");
    await expect(memberPicker).toHaveCount(0);

    // Editing with a typed name two members share fails visibly instead of notifying nobody.
    const twinName = `Twin ${runId}`;
    namesakes = await addNamesakes(relayUrl, twinName);
    for (const pubkey of namesakes) await addMember(adminPage, pubkey);
    await adminPage.getByRole("button", { name: /^Members: \d+$/ }).click();
    const membersDialog = adminPage.getByRole("dialog", { name: /Members · / });
    await expect(
      membersDialog.getByRole("button", { name: `Remove ${twinName}`, exact: true }),
    ).toHaveCount(2, { timeout: 30_000 });
    await membersDialog.getByRole("button", { name: "Close", exact: true }).click();
    const ownEmojiMessage = adminPage.locator("article").filter({ hasText: "shipped" });
    await ownEmojiMessage.hover();
    await ownEmojiMessage.getByRole("button", { name: "More message actions" }).click();
    await ownEmojiMessage
      .getByRole("menu", { name: "More message actions" })
      .getByRole("menuitem", { name: "Edit message" })
      .click();
    const editDialog = adminPage.getByRole("dialog", { name: "Edit message" });
    const editBody = editDialog.getByLabel("Message");
    await editBody.fill(`:${shortcode}: shipped @${twinName}`);
    await editDialog.getByRole("button", { name: "Save" }).click();
    await expect(editDialog.getByRole("alert")).toHaveText(
      `The mention @${twinName} is ambiguous. Choose a recipient from the mention picker.`,
    );
    await capture(adminPage, "composer-desktop-ambiguous-edit.png");
    await editBody.fill(`:${shortcode}: shipped today`);
    await editDialog.getByRole("button", { name: "Save" }).click();
    await expect(editDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(emojiMessage).toContainText("shipped today", { timeout: 30_000 });

    await adminPage.getByRole("button", { name: "Insert emoji" }).click();
    await picker.getByRole("tab", { name: "My emoji" }).click();
    await picker.getByRole("button", { name: `Remove :${shortcode}:` }).click();
    await expect(picker.getByRole("status")).toHaveText(`Removed :${shortcode}:`, {
      timeout: 30_000,
    });
    await relayWaitFor(relayUrl, ownEmojiSet, (found) => found.length > 0 && !hasShortcode(found));
    await adminPage.keyboard.press("Escape");

    await memberPage.setViewportSize({ width: 390, height: 844 });
    const memberComposer = memberPage.getByRole("textbox", {
      name: `Send a message to #${channelName}`,
    });
    await expect(memberComposer).toBeVisible();
    await memberPage.getByRole("button", { name: "Toggle formatting" }).click();
    await memberComposer.click();
    await memberPage.keyboard.type("mobile reply");
    await capture(memberPage, "composer-mobile-formatting.png");
    await memberPage.getByRole("button", { name: "Insert emoji" }).click();
    await memberPicker.getByRole("tab", { name: "Emoji", exact: true }).click();
    await expect(memberPicker.getByText("Loading emoji…")).toHaveCount(0, { timeout: 30_000 });
    // The removal arrived live: the member's palette no longer offers the removed emoji.
    await expect(
      memberPicker.getByRole("button", { name: `:${shortcode}:`, exact: true }),
    ).toHaveCount(0);
    await capture(memberPage, "composer-mobile-emoji.png");
    const overflow = await memberPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await removeOwnEmoji(relayUrl, shortcode).catch(() => undefined);
    if (namesakes.length) await removeFromCommunity(relayUrl, namesakes).catch(() => undefined);
    if (channelCreated) await archiveChannel(adminPage, channelName).catch(() => undefined);
    await adminClient.browser.close();
    await memberClient.browser.close();
  }
});
