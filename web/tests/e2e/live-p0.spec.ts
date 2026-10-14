import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { nip19 } from "nostr-tools";
import { getPublicKey } from "nostr-tools/pure";

type LiveIdentity = {
  nsec: string;
  pubkey: string;
  vaultPassphrase: string;
};

function identityFromEnvironment(name: "BUZZ_LIVE_ADMIN_NSEC" | "BUZZ_LIVE_MEMBER_NSEC") {
  const nsec = process.env[name]?.trim();
  if (!nsec) throw new Error(`${name} is required for live Relay acceptance tests.`);

  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(nsec);
  } catch {
    throw new Error(`${name} must contain a valid dedicated test identity.`);
  }
  if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) {
    throw new Error(`${name} must contain a valid dedicated test identity.`);
  }

  const pubkey = getPublicKey(decoded.data);
  decoded.data.fill(0);
  return {
    nsec,
    pubkey,
    vaultPassphrase: randomBytes(24).toString("base64url"),
  } satisfies LiveIdentity;
}

const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
if (admin.pubkey === member.pubkey) {
  throw new Error("Live Relay acceptance requires two distinct dedicated test identities.");
}

async function waitForRelay(page: Page) {
  await page.keyboard.press("Control+,");
  const settings = page.getByTestId("workspace-tool-settings");
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Identity" }).click();
  const status = settings
    .locator("dt")
    .filter({ hasText: "Status" })
    .locator("xpath=following-sibling::dd[1]");
  await expect(status).toHaveText("Connected", { timeout: 30_000 });
  await settings.getByRole("button", { name: "Back", exact: true }).click();
}

async function importIdentity(page: Page, identity: LiveIdentity) {
  await page.goto("./");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByLabel("nsec private key").fill(identity.nsec);
  await page.getByLabel("Encrypt and save on this device").check();
  await page.getByLabel("New vault passphrase").fill(identity.vaultPassphrase);
  await page.getByLabel("Confirm passphrase").fill(identity.vaultPassphrase);
  await page.getByRole("button", { name: "Connect to Relay" }).click();
  await expect(page.getByRole("button", { name: "Profile menu" })).toBeVisible();
  await waitForRelay(page);
}

async function unlockIdentity(page: Page, identity: LiveIdentity) {
  await page.getByLabel("Vault passphrase").fill(identity.vaultPassphrase);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("button", { name: "Profile menu" })).toBeVisible();
  await waitForRelay(page);
}

async function createPrivateChannel(page: Page, channelName: string) {
  await page.getByRole("button", { name: "Browse channels" }).click();
  const browser = page.getByRole("dialog", { name: "Browse channels" });
  await browser.getByRole("button", { name: "Create", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create channel" });
  await create.getByLabel("Name").fill(channelName);
  await create.getByLabel("Description").fill("Automated P0 acceptance; safe to archive.");
  await create.getByLabel("Type").selectOption("stream");
  await create.getByLabel("Visibility").selectOption("private");
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: channelName, exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function openChannel(page: Page, channelName: string) {
  const channel = page.getByRole("button", { name: channelName, exact: true });
  await expect(channel).toBeVisible({ timeout: 30_000 });
  await channel.click();
  await expect(page.getByRole("heading", { name: channelName, exact: true })).toBeVisible();
}

async function setChannelPreferences(page: Page) {
  await page.getByRole("button", { name: "Channel details" }).click();
  const details = page.getByRole("complementary", { name: "Channel details" });
  await details.getByRole("button", { name: "Add to favorites" }).click();
  await details.getByRole("button", { name: "Mute channel" }).click();
  await expect(details.getByRole("button", { name: "Remove from favorites" })).toBeVisible();
  await expect(details.getByRole("button", { name: "Unmute channel" })).toBeVisible();
  await details.getByRole("button", { name: "Close channel details" }).click();
}

async function expectChannelPreferences(page: Page) {
  await page.getByRole("button", { name: "Channel details" }).click();
  const details = page.getByRole("complementary", { name: "Channel details" });
  await expect(details.getByRole("button", { name: "Remove from favorites" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(details.getByRole("button", { name: "Unmute channel" })).toBeVisible();
  await details.getByRole("button", { name: "Close channel details" }).click();
}

async function addAndPromoteMember(page: Page, pubkey: string) {
  await page.getByRole("button", { name: /Members: / }).click();
  const members = page.getByRole("dialog", { name: /Members · / });
  await members.getByRole("button", { name: "Add member" }).click();
  await members.getByLabel("Member public key").fill(pubkey);
  await members.getByLabel("Role").selectOption("guest");
  await members.getByRole("button", { name: "Add member" }).last().click();

  const role = members.locator('select[aria-label^="Change "]').first();
  await expect(role).toHaveValue("guest", { timeout: 30_000 });
  await expect(role).toBeEnabled();
  await role.selectOption("admin");
  await expect(role).toHaveValue("admin");
  await expect(role).toBeEnabled({ timeout: 30_000 });
  await role.selectOption("member");
  await expect(role).toHaveValue("member");
  await expect(role).toBeEnabled({ timeout: 30_000 });
  await members.getByRole("button", { name: "Close" }).click();
}

async function removeManagedMember(page: Page) {
  await page.getByRole("button", { name: /Members: / }).click();
  const members = page.getByRole("dialog", { name: /Members · / });
  const remove = members.getByRole("button", { name: /^Remove / }).first();
  if (await remove.isVisible().catch(() => false)) {
    await remove.click();
    await page
      .getByRole("dialog", { name: "Remove member" })
      .getByRole("button", { name: "Remove member" })
      .click();
    await expect(members.locator('select[aria-label^="Change "]')).toHaveCount(0, {
      timeout: 30_000,
    });
  }
  await members.getByRole("button", { name: "Close" }).click();
}

async function inboxUnreadCount(page: Page): Promise<number> {
  const badge = page.getByTestId("inbox-unread-count");
  if (!(await badge.count())) return 0;
  const value = (await badge.textContent())?.trim() ?? "0";
  return value === "99+" ? 100 : Number.parseInt(value, 10);
}

async function exerciseReconnectInboxRecovery(
  adminPage: Page,
  memberPage: Page,
  memberContext: BrowserContext,
  channelName: string,
  runId: string,
) {
  await memberPage
    .getByTestId("workspace-tool-settings")
    .getByRole("button", { name: "Back", exact: true })
    .click();
  const memberRootText = `member reconnect root ${runId}`;
  const memberComposer = memberPage.getByLabel(`Send a message to #${channelName}`);
  await memberComposer.fill(memberRootText);
  await memberComposer.press("Enter");
  await expect(memberPage.locator("article").filter({ hasText: memberRootText })).toBeVisible({
    timeout: 30_000,
  });

  const adminRoot = adminPage.locator("article").filter({ hasText: memberRootText });
  await expect(adminRoot).toBeVisible({ timeout: 30_000 });
  await memberPage.keyboard.press("Control+,");
  const settings = memberPage.getByTestId("workspace-tool-settings");
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Identity" }).click();
  const status = settings
    .locator("dt")
    .filter({ hasText: "Status" })
    .locator("xpath=following-sibling::dd[1]");
  const unreadBefore = await inboxUnreadCount(memberPage);

  await memberContext.setOffline(true);
  await expect(status).toHaveText(/Disconnected|Reconnecting/, { timeout: 30_000 });
  // Read markers have whole-second resolution and an event counts as unread only when
  // created_at > marker (same rule as desktop). Keep the reply out of the second in
  // which the member's own root marked the channel read.
  await adminPage.waitForTimeout(1_100);

  const replyText = `reply delivered after reconnect ${runId}`;
  await adminRoot.hover();
  await adminRoot.getByRole("button", { name: "Reply in thread" }).click();
  const adminThread = adminPage.getByRole("complementary", { name: "Thread" });
  await adminThread.getByLabel("Reply to thread").fill(replyText);
  await adminThread.getByLabel("Reply to thread").press("Enter");
  await expect(adminThread.getByText(replyText, { exact: true })).toBeVisible({ timeout: 30_000 });
  await adminThread.getByRole("button", { name: "Close thread" }).click();

  await memberContext.setOffline(false);
  await expect(status).toHaveText("Connected", { timeout: 30_000 });
  const memberChannel = memberPage.getByRole("button", { name: channelName, exact: true });
  await expect(memberChannel).toHaveAttribute("title", /\d+ unread in /, { timeout: 30_000 });
  await expect
    .poll(() => inboxUnreadCount(memberPage), { timeout: 30_000 })
    .toBeGreaterThan(unreadBefore);

  await memberPage.getByRole("button", { name: "Inbox", exact: true }).first().click();
  const inbox = memberPage.getByTestId("workspace-tool-inbox");
  await expect(inbox.getByText(replyText, { exact: true })).toBeVisible({ timeout: 30_000 });
  await inbox.getByRole("button", { name: new RegExp(replyText) }).click();
  await inbox.getByRole("button", { name: "Open conversation" }).click();
  const memberThread = memberPage.getByRole("complementary", { name: "Thread" });
  await expect(memberThread.getByText(replyText, { exact: true })).toBeVisible();
  await memberThread.getByRole("button", { name: "Close thread" }).click();
  await expect(memberChannel).not.toHaveAttribute("title", /unread in /, { timeout: 30_000 });
  await memberPage.keyboard.press("Control+,");
  await expect(memberPage.getByTestId("workspace-tool-settings")).toBeVisible();
}

async function exerciseMessageLifecycle(
  page: Page,
  channelName: string,
  runId: string,
  onRootSent: () => Promise<void>,
) {
  const composer = page.getByLabel(`Send a message to #${channelName}`);
  const draft = `live draft ${runId}`;
  await composer.fill(draft);
  await page.waitForTimeout(350);
  await page.reload();
  await unlockIdentity(page, admin);
  await openChannel(page, channelName);
  await expect(composer).toHaveText(draft);

  const original = `live root ${runId}`;
  const edited = `live root edited ${runId}`;
  await composer.fill(original);
  await composer.press("Enter");
  const originalRoot = page.locator("article").filter({ hasText: original });
  await expect(originalRoot).toBeVisible({ timeout: 30_000 });
  const rootId = await originalRoot.getAttribute("data-message-id");
  if (!rootId) throw new Error("The live Relay message is missing its event id.");
  const root = page.locator(`article[data-message-id="${rootId}"]`);
  await onRootSent();

  await root.hover();
  await root.getByRole("button", { name: "Reaction 👀" }).click();
  await expect(root.getByRole("button", { name: "👀, 1 reactions" })).toBeVisible();

  await root.hover();
  await root.getByRole("button", { name: "Reply in thread" }).click();
  const thread = page.getByRole("complementary", { name: "Thread" });
  await thread.getByLabel("Reply to thread").fill(`live reply ${runId}`);
  await thread.getByLabel("Reply to thread").press("Enter");
  await expect(root.getByRole("button", { name: "1 replies" })).toBeVisible({ timeout: 30_000 });
  await thread.getByRole("button", { name: "Close thread" }).click();

  await root.hover();
  await root.getByRole("button", { name: "More message actions" }).click();
  await root
    .getByRole("menu", { name: "More message actions" })
    .getByRole("menuitem", { name: "Edit message" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit message" });
  await edit.getByLabel("Message").fill(edited);
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(root).toContainText(edited);
  await expect(root).toContainText("edited");

  await root.hover();
  await root.getByRole("button", { name: "More message actions" }).click();
  await root
    .getByRole("menu", { name: "More message actions" })
    .getByRole("menuitem", { name: "Delete message" })
    .click();
  await page
    .getByRole("dialog", { name: "Delete message" })
    .getByRole("button", { name: "Delete message" })
    .click();
  await expect(root).toHaveAttribute("data-deleted", "true", { timeout: 30_000 });
  await expect(root).toContainText("This message was deleted");
  await expect(root.getByRole("button", { name: "1 replies" })).toBeVisible();
  // A tombstone keeps its thread but no longer offers reactions on removed content.
  await expect(root.getByRole("button", { name: "👀, 1 reactions" })).toHaveCount(0);
}

async function archiveChannel(page: Page, channelName: string) {
  await page.keyboard.press("Escape");
  await openChannel(page, channelName);
  await page.getByRole("button", { name: "Channel details" }).click();
  await page
    .getByRole("complementary", { name: "Channel details" })
    .getByRole("button", { name: "Archive channel" })
    .click();
  await page
    .getByRole("dialog", { name: "Archive channel" })
    .getByRole("button", { name: "Archive channel" })
    .click();
  await expect(page.getByRole("button", { name: channelName, exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
}

test("P0 collaboration workflows interoperate with a real Relay", async ({ browser }, testInfo) => {
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const channelName = `web-p0-${runId}`;
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Live Relay base URL is unavailable.");
  const adminContext = await browser.newContext({ baseURL, locale: "en-US" });
  const adminMirrorContext = await browser.newContext({ baseURL, locale: "en-US" });
  const memberContext = await browser.newContext({ baseURL, locale: "en-US" });
  const adminPage = await adminContext.newPage();
  const adminMirrorPage = await adminMirrorContext.newPage();
  const memberPage = await memberContext.newPage();
  let channelCreated = false;
  let memberAdded = false;

  try {
    await importIdentity(adminPage, admin);
    await importIdentity(memberPage, member);

    await createPrivateChannel(adminPage, channelName);
    channelCreated = true;
    await memberPage.reload();
    await unlockIdentity(memberPage, member);
    await expect(memberPage.getByRole("button", { name: channelName, exact: true })).toHaveCount(0);

    await setChannelPreferences(adminPage);
    await importIdentity(adminMirrorPage, admin);
    await openChannel(adminMirrorPage, channelName);
    await expectChannelPreferences(adminMirrorPage);
    await addAndPromoteMember(adminPage, member.pubkey);
    memberAdded = true;

    await memberPage.reload();
    await unlockIdentity(memberPage, member);
    await openChannel(memberPage, channelName);
    await memberPage.keyboard.press("Control+,");
    await expect(memberPage.getByTestId("workspace-tool-settings")).toBeVisible();

    await exerciseReconnectInboxRecovery(adminPage, memberPage, memberContext, channelName, runId);

    await exerciseMessageLifecycle(adminPage, channelName, runId, async () => {
      const memberChannel = memberPage.getByRole("button", { name: channelName, exact: true });
      await expect(memberChannel).toHaveAttribute("title", /\d+ unread in /, {
        timeout: 30_000,
      });
      await memberChannel.click();
      await expect(
        memberPage.getByRole("heading", { name: channelName, exact: true }),
      ).toBeVisible();
      await expect(memberChannel).not.toHaveAttribute("title", /unread in /, { timeout: 30_000 });
    });
    await expectChannelPreferences(adminPage);

    await memberPage.reload();
    await unlockIdentity(memberPage, member);
    await openChannel(memberPage, channelName);
    await expect(
      memberPage.getByRole("button", { name: channelName, exact: true }),
    ).not.toHaveAttribute("title", /unread in /, { timeout: 30_000 });

    await removeManagedMember(adminPage);
    memberAdded = false;
    await memberPage.reload();
    await unlockIdentity(memberPage, member);
    await expect(memberPage.getByRole("button", { name: channelName, exact: true })).toHaveCount(
      0,
      {
        timeout: 30_000,
      },
    );
  } finally {
    if (channelCreated) {
      if (memberAdded) await removeManagedMember(adminPage).catch(() => undefined);
      await archiveChannel(adminPage, channelName);
    }
    await memberContext.close();
    await adminMirrorContext.close();
    await adminContext.close();
  }
});
