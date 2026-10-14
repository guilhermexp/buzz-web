import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  addMember,
  archiveChannel,
  identityFromEnvironment,
  importIdentity,
  liveRelayUrl,
  openChannel,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");

function evidence(name: string): string | undefined {
  const directory = process.env.COLLAB_EVIDENCE_DIR;
  return directory ? `${directory}/forums-${name}.png` : undefined;
}

async function createPrivateForum(page: Page, channelName: string) {
  await page.getByRole("button", { name: "Browse channels" }).click();
  const browser = page.getByRole("dialog", { name: "Browse channels" });
  await browser.getByRole("button", { name: "Create", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create channel" });
  await create.getByLabel("Name").fill(channelName);
  await create.getByLabel("Description").fill("Automated forum acceptance; safe to archive.");
  await create.getByLabel("Type").selectOption("forum");
  await create.getByLabel("Visibility").selectOption("private");
  const heading = page.getByRole("heading", { name: channelName, exact: true });
  const rateLimited = create.getByText(/rate-limited/);
  // The shared admin identity is used by many live suites; the Relay may throttle 9007.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await create.getByRole("button", { name: "Create", exact: true }).click();
    await expect(heading.or(rateLimited)).toBeVisible({ timeout: 30_000 });
    if (await heading.isVisible()) break;
    await page.waitForTimeout(5_000);
  }
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Forum posts" })).toBeVisible();
}

function topicRow(page: Page, title: string) {
  return page.locator("[data-forum-topic-id]").filter({
    has: page.getByRole("button", { name: title, exact: true }),
  });
}

function forumEntry(page: Page, text: string) {
  return page.locator("[data-forum-event-id]").filter({ hasText: text });
}

/**
 * The live identities are shared by every suite, so the Relay may answer
 * "rate-limited: … retry in Ns". The UI surfaces that error and keeps the input,
 * so the user's recovery is to submit again; do exactly that.
 */
async function submitUntil(page: Page, submit: () => Promise<void>, done: Locator) {
  const limited = page.getByText(/rate-limited/).first();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await submit();
    await expect(done.or(limited).first()).toBeVisible({ timeout: 30_000 });
    if (await done.first().isVisible()) return;
    await page.waitForTimeout(4_000);
  }
  await expect(done.first()).toBeVisible();
}

test("forum topic lifecycle across two identities with moderation", async ({ browser }) => {
  const suffix = Date.now().toString(36);
  const channelName = `forum-live-${suffix}`;
  const title = `Release checklist ${suffix}`;
  const replyText = `Member reply ${suffix}`;
  const editedReply = `Member reply edited ${suffix}`;
  const nestedText = `Admin nested answer ${suffix}`;

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminPage = await adminContext.newPage();
  const memberPage = await memberContext.newPage();
  const pageErrors: string[] = [];
  for (const [label, page] of [
    ["admin", adminPage],
    ["member", memberPage],
  ] as const) {
    page.on("pageerror", (error) => {
      pageErrors.push(`[${label}] ${error.message}`);
      console.log(`[${label} pageerror] ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`[${label} console] ${message.text()}`);
    });
  }
  const relay = await NodeRelayClient.connect(liveRelayUrl(), member.secretKey);
  let channelCreated = false;

  try {
    await importIdentity(adminPage, admin);
    await createPrivateForum(adminPage, channelName);
    channelCreated = true;
    await addMember(adminPage, member.pubkey);

    // Admin creates a topic (title + Markdown body).
    await adminPage.getByRole("button", { name: "New post", exact: true }).click();
    await adminPage.getByLabel("Title", { exact: true }).fill(title);
    const body = adminPage.getByRole("textbox", { name: "Write your post..." });
    await body.click();
    await body.pressSequentially("Please confirm the **release** steps.");
    await submitUntil(
      adminPage,
      () => adminPage.getByRole("button", { name: "Send message" }).click(),
      topicRow(adminPage, title),
    );
    await expect(topicRow(adminPage, title)).toContainText("0 replies");
    const postId =
      (await topicRow(adminPage, title).getAttribute("data-forum-topic-id")) ?? "missing";
    expect(postId).toMatch(/^[0-9a-f]{64}$/);

    // The relay stored the post in Desktop's shape: h tag, title as leading heading.
    const [storedPost] = await relay.query([{ ids: [postId] }]);
    expect(storedPost.kind).toBe(45001);
    expect(storedPost.content.startsWith(`# ${title}\n\n`)).toBe(true);
    const channelId = storedPost.tags.find((tag) => tag[0] === "h")?.[1] ?? "missing";
    expect(channelId).toMatch(/^[0-9a-f-]{36}$/);

    // Member sees the topic as unread, opens it and replies.
    await importIdentity(memberPage, member);
    await openChannel(memberPage, channelName);
    const memberRow = topicRow(memberPage, title);
    await expect(memberRow).toBeVisible({ timeout: 30_000 });
    await expect(memberRow).toHaveAttribute("data-unread", "true");
    await expect(memberRow.getByText("Unread", { exact: true })).toBeVisible();
    await memberPage.screenshot({ path: evidence("list-desktop") });

    await memberRow.getByRole("button", { name: title, exact: true }).click();
    await expect(memberPage.getByRole("button", { name: "Back to posts" })).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: title, exact: true })).toBeVisible();
    // Member may neither edit nor delete the admin's post.
    await expect(memberPage.getByRole("button", { name: "Delete post" })).toHaveCount(0);
    await expect(memberPage.getByRole("button", { name: "Edit post" })).toHaveCount(0);
    const reply = memberPage.getByRole("textbox", { name: "Reply to this post..." });
    await reply.click();
    await reply.pressSequentially(replyText);
    await submitUntil(
      memberPage,
      () => memberPage.getByRole("button", { name: "Send message" }).click(),
      forumEntry(memberPage, replyText),
    );

    // Admin's list updates live: reply count and latest activity.
    const adminRow = topicRow(adminPage, title);
    await expect(adminRow).toContainText("1 reply", { timeout: 30_000 });
    await expect(adminRow).toContainText("Last activity");
    await adminPage.screenshot({ path: evidence("admin-list-live-desktop") });

    // Member edits their own reply.
    const memberReply = forumEntry(memberPage, replyText);
    await memberReply.getByRole("button", { name: "Edit reply" }).click();
    await memberPage.getByRole("textbox", { name: "Edit reply" }).fill(editedReply);
    await submitUntil(
      memberPage,
      () => memberPage.getByRole("button", { name: "Save", exact: true }).click(),
      forumEntry(memberPage, editedReply).getByText("(edited)"),
    );

    const [storedReply] = await relay.query([
      { kinds: [45003], "#h": [channelId], "#e": [postId] },
    ]);
    expect(storedReply.tags).toContainEqual(["e", postId, "", "reply"]);
    expect(storedReply.tags.filter((tag) => tag[0] === "e")).toHaveLength(1);
    const edits = await relay.query([
      { kinds: [40003], "#h": [channelId], "#e": [storedReply.id] },
    ]);
    expect(edits.map((edit) => edit.content)).toEqual([editedReply]);

    // Mobile list ↔ detail for the member.
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await memberPage.screenshot({ path: evidence("detail-mobile") });
    await memberPage.getByRole("button", { name: "Back to posts" }).click();
    await expect(topicRow(memberPage, title)).toBeVisible();
    await expect(topicRow(memberPage, title)).not.toHaveAttribute("data-unread", "true");
    await memberPage.screenshot({ path: evidence("list-mobile") });
    await memberPage.setViewportSize({ width: 1440, height: 900 });
    await topicRow(memberPage, title).getByRole("button", { name: title, exact: true }).click();

    // Admin opens the topic, sees the edit, answers in a nested reply, then moderates.
    await adminRow.getByRole("button", { name: title, exact: true }).click();
    const adminView = forumEntry(adminPage, editedReply);
    await expect(adminView).toContainText("(edited)", { timeout: 30_000 });
    await adminView.getByRole("button", { name: "Reply", exact: true }).click();
    const adminReply = adminPage.getByRole("textbox", { name: "Reply to this post..." });
    await adminReply.click();
    await adminReply.pressSequentially(nestedText);
    await submitUntil(
      adminPage,
      () => adminPage.getByRole("button", { name: "Send message" }).click(),
      forumEntry(adminPage, nestedText),
    );
    await expect(forumEntry(memberPage, nestedText)).toBeVisible({ timeout: 30_000 });
    const nested = await relay.waitFor(
      [{ kinds: [45003], "#h": [channelId], "#e": [postId] }],
      (events) => events.some((event) => event.content === nestedText),
    );
    const nestedEvent = nested.find((event) => event.content === nestedText);
    expect(nestedEvent?.tags.filter((tag) => tag[0] === "e")).toEqual([
      ["e", postId, "", "root"],
      ["e", storedReply.id, "", "reply"],
    ]);
    await adminPage.screenshot({ path: evidence("detail-desktop") });

    // Deep link: the nested answer to the member's reply lands in the member's Inbox
    // (thread category); "Show in chat" opens the forum topic with that reply highlighted.
    await memberPage.getByRole("button", { name: "Back to posts" }).click();
    await memberPage.getByRole("button", { name: "Inbox", exact: true }).first().click();
    const inboxItem = memberPage
      .locator("li")
      .filter({ has: memberPage.locator("[data-inbox-row]", { hasText: nestedText }) });
    await expect(inboxItem).toBeVisible({ timeout: 30_000 });
    await inboxItem.hover();
    await inboxItem.getByRole("button", { name: "Show in chat" }).click();
    const highlighted = memberPage.locator("[data-highlighted]").filter({ hasText: nestedText });
    await expect(highlighted).toBeVisible({ timeout: 30_000 });
    await expect(
      highlighted.locator(`[data-forum-event-id="${nestedEvent?.id ?? "missing"}"]`),
    ).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await memberPage.screenshot({ path: evidence("deep-link-highlight-desktop") });

    await forumEntry(adminPage, editedReply)
      .first()
      .getByRole("button", { name: "Delete reply" })
      .first()
      .click();
    const confirm = adminPage.getByRole("dialog", { name: "Delete reply?" });
    await submitUntil(
      adminPage,
      () => confirm.getByRole("button", { name: "Delete reply", exact: true }).click(),
      adminPage.getByRole("heading", { name: "1 reply" }),
    );
    await expect(confirm).toHaveCount(0);
    await expect(adminPage.getByText(editedReply, { exact: true })).toHaveCount(0);
    // The member's view converges live; the nested answer survives at the top level.
    await expect(memberPage.getByText(editedReply, { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(forumEntry(memberPage, nestedText)).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "1 reply" })).toBeVisible();

    // A forced delete of the admin's post by the member is rejected by the Relay.
    await expect(
      relay.publish(
        {
          kind: 5,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [
            ["h", channelId],
            ["e", postId],
          ],
        },
        member.secretKey,
      ),
    ).rejects.toThrow(/must be event author/);
    await expect(
      relay.publish(
        {
          kind: 9005,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [
            ["h", channelId],
            ["e", postId],
          ],
        },
        member.secretKey,
      ),
    ).rejects.toThrow(/owner\/admin/);
    expect(await relay.query([{ ids: [postId] }])).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  } catch (error) {
    console.log(`[forums] failed before cleanup: ${(error as Error).message.split("\n")[0]}`);
    await adminPage.screenshot({ path: evidence("failure-admin") }).catch(() => undefined);
    await memberPage.screenshot({ path: evidence("failure-member") }).catch(() => undefined);
    throw error;
  } finally {
    relay.close();
    if (channelCreated) {
      await adminPage.keyboard.press("Escape");
      await adminPage
        .getByRole("button", { name: "Back to posts" })
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      await archiveChannel(adminPage, channelName).catch(async (error: Error) => {
        // UI archive can be throttled by the shared Relay; archive through the protocol instead.
        console.log(
          `[forums] UI archive failed, archiving via Relay: ${error.message.split("\n")[0]}`,
        );
        const adminRelay = await NodeRelayClient.connect(liveRelayUrl(), admin.secretKey);
        try {
          const metadata = await adminRelay.query([{ kinds: [39000], limit: 1000 }]);
          const channel = metadata.find((event) =>
            event.tags.some((tag) => tag[0] === "name" && tag[1] === channelName),
          );
          const id = channel?.tags.find((tag) => tag[0] === "d")?.[1];
          if (!id) throw new Error(`channel ${channelName} not found for cleanup`);
          await adminRelay.publish(
            {
              kind: 9002,
              created_at: Math.floor(Date.now() / 1000),
              content: "",
              tags: [
                ["h", id],
                ["archived", "true"],
              ],
            },
            admin.secretKey,
          );
        } finally {
          adminRelay.close();
        }
      });
    }
    await adminContext.close();
    await memberContext.close();
  }
});
