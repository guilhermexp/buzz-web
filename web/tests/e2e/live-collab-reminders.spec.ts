import { randomUUID } from "node:crypto";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { nip44 } from "nostr-tools";
import type { NostrEvent } from "nostr-tools/pure";
import {
  addMember,
  archiveChannel,
  browserEnvironment,
  createPrivateChannel,
  identityFromEnvironment,
  importIdentity,
  type LiveIdentity,
  liveRelayUrl,
  openChannel,
  reloadAndUnlock,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

const evidenceDir = process.env.COLLAB_EVIDENCE_DIR;
const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
const timezoneId = Intl.DateTimeFormat().resolvedOptions().timeZone;

test.use({ launchOptions: { env: browserEnvironment() } });

type Decrypted = {
  event: NostrEvent;
  d: string;
  notBefore: string | undefined;
  expiration: string | undefined;
  content: { status: string; note?: string; target?: { eventId: string; channelId: string } };
};

async function screenshot(page: Page, name: string) {
  if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/reminders-${name}.png` });
}

async function openSession(browser: Browser, identity: LiveIdentity, mobile = false) {
  const context = await browser.newContext({
    timezoneId,
    // The frozen importIdentity helper asserts the sidebar's "Profile menu", which the closed
    // mobile drawer hides; import at desktop width, then switch to the 390px mobile layout.
    viewport: { width: 1440, height: 900 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  await importIdentity(page, identity);
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  return { context, page };
}

/** Opens the Inbox and its Reminders section (a filter option when the shell offers one). */
async function openInboxReminders(page: Page): Promise<Locator> {
  // At 390px the rail sits in an off-canvas drawer; use the in-viewport (bottom nav) button.
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  for (const button of await page.getByRole("button", { name: "Inbox", exact: true }).all()) {
    const box = await button.boundingBox();
    if (!box || box.x < 0 || box.x + box.width > viewport.width) continue;
    if (box.y < 0 || box.y + box.height > viewport.height) continue;
    await button.click();
    break;
  }
  const inbox = page.getByTestId("workspace-tool-inbox");
  const filters = inbox.getByLabel("Filter Inbox");
  for (const filter of await filters.all()) {
    if (!(await filter.isVisible())) continue;
    const options = await filter.locator("option").allTextContents();
    if (options.includes("Reminders")) await filter.selectOption({ label: "Reminders" });
  }
  const reminders = inbox.getByRole("region", { name: "Reminders", exact: true });
  await expect(reminders).toBeVisible();
  return reminders;
}

async function remindMeLater(page: Page, message: Locator) {
  await message.hover();
  const desktop = message.getByRole("button", { name: /^More (message )?actions$/ });
  if (await desktop.isVisible()) await desktop.click();
  else await message.getByRole("button", { name: "Open message actions" }).click();
  await page.getByRole("menuitem", { name: "Remind me later" }).click();
  const dialog = page.getByRole("dialog", { name: "Remind me later" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Next local minute at least `leadSeconds` away (the native time input has minute precision). */
function nextMinute(leadSeconds: number) {
  const target = new Date(Date.now() + leadSeconds * 1_000);
  if (target.getSeconds() !== 0 || target.getMilliseconds() !== 0) {
    target.setSeconds(0, 0);
    target.setMinutes(target.getMinutes() + 1);
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    unix: Math.floor(target.getTime() / 1_000),
    date: `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`,
    time: `${pad(target.getHours())}:${pad(target.getMinutes())}`,
  };
}

async function memberReminders(relay: NodeRelayClient): Promise<Decrypted[]> {
  const key = nip44.getConversationKey(member.secretKey, member.pubkey);
  const events = await relay.query([{ kinds: [30300], authors: [member.pubkey] }]);
  return events.map((event) => {
    const tag = (name: string) => event.tags.find((entry) => entry[0] === name)?.[1];
    return {
      event,
      d: tag("d") ?? "",
      notBefore: tag("not_before"),
      expiration: tag("expiration"),
      content: JSON.parse(nip44.decrypt(event.content, key)),
    };
  });
}

/** Inbox nav badge minus the Inbox's own unread count: the due-reminder contribution. */
async function dueBadgeExcess(page: Page): Promise<number> {
  const badge = page.getByTestId("inbox-unread-count");
  const badgeCount = (await badge.count()) ? Number(await badge.first().textContent()) : 0;
  const unreadText = await page
    .getByTestId("workspace-tool-inbox")
    .getByText(/^\d+ unread$/)
    .first()
    .textContent();
  return badgeCount - Number(unreadText?.match(/\d+/)?.[0] ?? Number.NaN);
}

async function reminderFor(relay: NodeRelayClient, eventId: string): Promise<Decrypted> {
  const found = (await memberReminders(relay)).filter(
    (item) => item.content.target?.eventId === eventId,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/** Protocol-level archive for cleanup when the run failed before the UI archive step. */
async function archiveByName(relay: NodeRelayClient, channelName: string) {
  const metadata = await relay.query([{ kinds: [39000], limit: 1000 }]);
  const channel = metadata.find((event) =>
    event.tags.some((tag) => tag[0] === "name" && tag[1] === channelName),
  );
  const id = channel?.tags.find((tag) => tag[0] === "d")?.[1];
  if (!id) return;
  await relay.publish(
    {
      kind: 9002,
      created_at: Math.floor(Date.now() / 1_000),
      content: "",
      tags: [
        ["h", id],
        ["archived", "true"],
      ],
    },
    admin.secretKey,
  );
}

test("Reminders: create, persist, deliver when due, snooze/complete/cancel, author-only", async ({
  browser,
}) => {
  const runId = randomUUID().slice(0, 8);
  const channelName = `reminders-${runId}`;
  const textA = `reminder target A ${runId}`;
  const textB = `reminder target B ${runId}`;
  const memberRelay = await NodeRelayClient.connect(liveRelayUrl(), member.secretKey);
  const adminRelay = await NodeRelayClient.connect(liveRelayUrl(), admin.secretKey);
  const created: string[] = [];
  let archived = false;
  // Members cannot create channels: the admin creates a private one and adds the member.
  const adminSession = await openSession(browser, admin);
  const memberSession = await openSession(browser, member);
  const page = memberSession.page;
  try {
    await createPrivateChannel(adminSession.page, channelName);
    await addMember(adminSession.page, member.pubkey);
    await reloadAndUnlock(page, member);
    await openChannel(page, channelName);
    const composer = page.getByLabel(`Send a message to #${channelName}`);
    await composer.fill(textA);
    await composer.press("Enter");
    const messageA = page.locator("article").filter({ hasText: textA });
    await expect(messageA).toHaveAttribute("data-message-id", /^[0-9a-f]{64}$/, {
      timeout: 30_000,
    });
    const eventA = (await messageA.getAttribute("data-message-id")) ?? "";

    // Remind me later → custom time at the next minute ≥ 25s ahead, with a note.
    const due = nextMinute(25);
    const dialog = await remindMeLater(page, messageA);
    await dialog.getByLabel("Reminder date").fill(due.date);
    await dialog.getByLabel("Reminder time").fill(due.time);
    await dialog.getByLabel("Note (optional)").fill(`note ${runId}`);
    await screenshot(page, "dialog-desktop");
    await dialog.getByRole("button", { name: "Set reminder" }).click();
    await expect(page.getByText("Reminder set")).toBeVisible();
    await expect(dialog).toHaveCount(0);

    const storedA = await reminderFor(memberRelay, eventA);
    created.push(storedA.d);
    expect(storedA.d).toMatch(/^[0-9a-f]{32}$/);
    expect(storedA.notBefore).toBe(String(due.unix));
    expect(storedA.content).toMatchObject({ status: "pending", note: `note ${runId}` });
    expect(storedA.event.content).not.toContain(textA);

    // Another member gets nothing: the Relay refuses foreign author-only reads.
    await expect(adminRelay.query([{ kinds: [30300], authors: [member.pubkey] }])).rejects.toThrow(
      /restricted/,
    );
    expect(await adminRelay.query([{ ids: [storedA.event.id] }])).toEqual([]);

    // Reload: the reminder is recovered from the Relay.
    await reloadAndUnlock(page, member);
    let reminders = await openInboxReminders(page);
    const upcoming = reminders.getByRole("region", { name: "Upcoming" });
    await expect(upcoming.getByRole("listitem", { name: textA })).toBeVisible();
    await expect(upcoming.getByText(`note ${runId}`)).toBeVisible();
    await expect(upcoming.getByText(`#${channelName}`)).toBeVisible();

    // Due delivery without reload: toast and the Due group.
    const toastTitle = page.getByText(`Reminder due · #${channelName}`);
    await expect(toastTitle).toBeVisible({ timeout: (due.unix - Date.now() / 1_000 + 30) * 1_000 });
    const dueGroup = reminders.getByRole("region", { name: "Due" });
    await expect(dueGroup.getByRole("listitem", { name: textA })).toBeVisible();
    await screenshot(page, "due-desktop");

    // A due reminder is announced once: not again after reload.
    await reloadAndUnlock(page, member);
    reminders = await openInboxReminders(page);
    await expect(
      reminders.getByRole("region", { name: "Due" }).getByRole("listitem", { name: textA }),
    ).toBeVisible();
    // Proving an absence needs a bounded wait past the post-load due check.
    await page.waitForTimeout(3_000);
    await expect(page.getByText(`Reminder due · #${channelName}`)).toHaveCount(0);

    // The Inbox nav badge counts the due reminder on top of the Inbox unread count.
    await expect.poll(() => dueBadgeExcess(page), { timeout: 20_000 }).toBe(1);

    // Complete A while due: the badge drops back.
    await reminders
      .getByRole("listitem", { name: textA })
      .getByRole("button", { name: "Complete" })
      .click();
    await expect(page.getByText("Reminder completed")).toBeVisible();
    await expect.poll(() => dueBadgeExcess(page), { timeout: 20_000 }).toBe(0);
    const doneA = await reminderFor(memberRelay, eventA);
    expect(doneA).toMatchObject({
      d: storedA.d,
      notBefore: undefined,
      content: { status: "done", note: `note ${runId}` },
    });

    // Second reminder from a preset.
    await openChannel(page, channelName);
    await composer.fill(textB);
    await composer.press("Enter");
    const messageB = page.locator("article").filter({ hasText: textB });
    await expect(messageB).toHaveAttribute("data-message-id", /^[0-9a-f]{64}$/, {
      timeout: 30_000,
    });
    const eventB = (await messageB.getAttribute("data-message-id")) ?? "";
    await (await remindMeLater(page, messageB))
      .getByRole("button", { name: "In 30 minutes" })
      .click();
    await expect(page.getByText("Reminder set").first()).toBeVisible();
    const storedB = await reminderFor(memberRelay, eventB);
    created.push(storedB.d);

    // Persisted across reload; then the mobile view of the same reminders.
    await reloadAndUnlock(page, member);
    reminders = await openInboxReminders(page);
    await expect(upcoming.getByRole("listitem", { name: textB })).toBeVisible();
    await expect(reminders.getByRole("listitem", { name: textA })).toHaveCount(0);
    await screenshot(page, "inbox-desktop");

    const mobile = await openSession(browser, member, true);
    try {
      const mobileReminders = await openInboxReminders(mobile.page);
      const mobileRowB = mobileReminders.getByRole("listitem", { name: textB });
      await expect(mobileRowB).toBeVisible();
      await screenshot(mobile.page, "inbox-mobile");
      await mobileRowB.getByRole("button", { name: "Snooze" }).click();
      await expect(mobile.page.getByRole("menu", { name: "Snooze options" })).toBeVisible();
      await screenshot(mobile.page, "snooze-mobile");
      await mobile.page.keyboard.press("Escape");
      // "Open message" navigates to the target; then the mobile message menu.
      await mobileRowB.getByRole("button", { name: "Open message" }).click();
      const mobileMessage = mobile.page.locator(`article[data-message-id="${eventB}"]`);
      await expect(mobileMessage).toBeVisible({ timeout: 30_000 });
      await remindMeLater(mobile.page, mobileMessage);
      await screenshot(mobile.page, "dialog-mobile");
    } finally {
      await mobile.context.close();
    }

    // Snooze B by one hour: same d, later not_before.
    await upcoming
      .getByRole("listitem", { name: textB })
      .getByRole("button", { name: "Snooze" })
      .click();
    await page
      .getByRole("menu", { name: "Snooze options" })
      .getByRole("menuitem", { name: "In 1 hour" })
      .click();
    await expect(page.getByText("Reminder snoozed")).toBeVisible();
    await expect
      .poll(async () => Number((await reminderFor(memberRelay, eventB)).notBefore))
      .toBeGreaterThan(Number(storedB.notBefore) + 1_500);
    expect((await reminderFor(memberRelay, eventB)).d).toBe(storedB.d);

    // Cancel B; completion and cancellation persist across reload.
    await upcoming
      .getByRole("listitem", { name: textB })
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(page.getByText("Reminder cancelled")).toBeVisible();
    const cancelledB = await reminderFor(memberRelay, eventB);
    expect(cancelledB).toMatchObject({
      d: storedB.d,
      notBefore: undefined,
      content: { status: "cancelled" },
    });
    for (const item of [doneA, cancelledB]) {
      const days = (Number(item.expiration) - item.event.created_at) / 86_400;
      expect(days).toBeGreaterThanOrEqual(30);
      expect(days).toBeLessThanOrEqual(90);
    }

    await reloadAndUnlock(page, member);
    reminders = await openInboxReminders(page);
    await expect(reminders.getByRole("listitem", { name: textB })).toHaveCount(0);
    await expect(reminders.getByRole("listitem", { name: textA })).toHaveCount(0);
    await reminders.getByRole("button", { name: /^Completed \(\d+\)$/ }).click();
    await expect(reminders.getByRole("listitem", { name: textA })).toBeVisible();
    await screenshot(page, "completed-desktop");

    // The admin's own client shows none of the member's reminders.
    const adminReminders = await openInboxReminders(adminSession.page);
    await expect(adminReminders.getByText(runId)).toHaveCount(0);
    await screenshot(adminSession.page, "admin-desktop");

    await archiveChannel(adminSession.page, channelName);
    archived = true;
  } finally {
    if (!archived) await archiveByName(adminRelay, channelName).catch(() => undefined);
    for (const d of created) {
      await memberRelay
        .publish(
          {
            kind: 5,
            created_at: Math.floor(Date.now() / 1_000),
            content: "",
            tags: [
              ["a", `30300:${member.pubkey}:${d}`],
              ["k", "30300"],
            ],
          },
          member.secretKey,
        )
        .catch(() => undefined);
    }
    memberRelay.close();
    adminRelay.close();
    await memberSession.context.close();
    await adminSession.context.close();
  }
});
