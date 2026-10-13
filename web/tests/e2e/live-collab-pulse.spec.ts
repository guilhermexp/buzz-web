import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { getPublicKey, type NostrEvent } from "nostr-tools/pure";
import {
  browserEnvironment,
  identityFromEnvironment,
  importIdentity,
  type LiveIdentity,
  liveRelayUrl,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

const evidenceDir = process.env.COLLAB_EVIDENCE_DIR;
const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");

test.use({ launchOptions: { env: browserEnvironment() } });

async function screenshot(page: Page, name: string) {
  if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/pulse-${name}.png` });
}

async function openSession(browser: Browser, identity: LiveIdentity) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await importIdentity(page, identity);
  return { context, page };
}

/** Opens Pulse from the desktop rail, or the mobile "More tools" menu at narrow widths. */
async function openPulse(page: Page): Promise<Locator> {
  const railButton = page.getByRole("button", { name: "Pulse", exact: true });
  if (await railButton.isVisible()) {
    await railButton.click();
  } else {
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Pulse", exact: true }).click();
  }
  const pulse = page.getByTestId("workspace-tool-pulse");
  await expect(pulse.getByRole("tablist", { name: "Pulse sections" })).toBeVisible();
  return pulse;
}

function noteCard(scope: Locator, text: string): Locator {
  return scope
    .getByRole("article")
    .filter({ has: scope.page().getByText(text, { exact: true }) })
    .first();
}

/** A valid 1x1 PNG, so the Relay's media pipeline sees a real image. */
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function follows(list: NostrEvent | undefined): string[] {
  return (list?.tags ?? []).filter((tag) => tag[0] === "p").map((tag) => tag[1]);
}

/** The shared Relay throttles bursts from many concurrent suites; retry its explicit back-off. */
async function retryRateLimited<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 8 || !String(error).includes("rate-limited")) throw error;
      await delay(1500 * attempt);
    }
  }
}

async function latestContacts(relay: NodeRelayClient, pubkey: string) {
  const lists = await retryRateLimited(() =>
    relay.query([{ kinds: [3], authors: [pubkey], limit: 1 }]),
  );
  return lists.sort((left, right) => right.created_at - left.created_at)[0];
}

test("Pulse: live notes, likes, replies, follows and profile navigation across two identities", async ({
  browser,
}) => {
  const relay = await NodeRelayClient.connect(liveRelayUrl(), admin.secretKey);
  // Start from "admin does not follow member" without touching other follows,
  // and remember the original list so it can be restored exactly.
  const original = await latestContacts(relay, admin.pubkey);
  // A pre-existing unrelated follow that the UI's follow must preserve.
  const sentinel = getPublicKey(new Uint8Array(32).fill(7));
  const publishAdmin = (template: Parameters<NodeRelayClient["publish"]>[0]) =>
    retryRateLimited(() => relay.publish(template, admin.secretKey));
  const baseline = await publishAdmin({
    kind: 3,
    created_at: Math.max(Math.floor(Date.now() / 1000), (original?.created_at ?? 0) + 1),
    content: original?.content ?? "",
    tags: [
      ...(original?.tags ?? []).filter(
        (tag) => !(tag[0] === "p" && [member.pubkey, sentinel].includes(tag[1])),
      ),
      ["p", sentinel],
    ],
  });

  const adminSession = await openSession(browser, admin);
  const memberSession = await openSession(browser, member);
  try {
    const adminPulse = await openPulse(adminSession.page);
    const memberPulse = await openPulse(memberSession.page);
    // Another client of the admin follows someone after Pulse loaded its list:
    // the browser's snapshot is now stale and its follow must not drop this.
    const lateFollow = getPublicKey(new Uint8Array(32).fill(9));
    await publishAdmin({
      kind: 3,
      created_at: baseline.created_at + 1,
      content: baseline.content,
      tags: [...baseline.tags, ["p", lateFollow]],
    });
    await expect(adminPulse.getByRole("tab", { name: "Everyone" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Member publishes; admin's already-open feed receives it live.
    const noteText = `Pulse acceptance ${randomUUID()}`;
    const composer = memberPulse.getByRole("textbox", { name: "What's on your mind?" });
    await composer.fill(noteText);
    await expect(memberPulse.getByText(`${noteText.length} characters`)).toBeVisible();
    await memberPulse.getByRole("button", { name: "Post", exact: true }).click();
    await expect(noteCard(memberPulse, noteText)).toBeVisible();
    await expect(composer).toHaveValue("");

    const pill = adminPulse.getByRole("button", { name: /^\d+ new notes?$/ });
    await expect(pill.or(noteCard(adminPulse, noteText))).toBeVisible();
    await screenshot(adminSession.page, "desktop-new-notes");
    if (await pill.isVisible()) await pill.click();
    const adminCard = noteCard(adminPulse, noteText);
    await expect(adminCard).toBeVisible();

    // Admin likes it; member sees the count live.
    await adminCard.getByRole("button", { name: "Like", exact: true }).click();
    await expect(adminCard.getByRole("button", { name: "Unlike", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(adminCard.getByTestId("pulse-like-count")).toHaveText("1");
    await expect(noteCard(memberPulse, noteText).getByTestId("pulse-like-count")).toHaveText("1");

    // Admin replies; the thread view shows the root and the reply.
    const replyText = `Pulse reply ${randomUUID()}`;
    await adminCard.getByRole("button", { name: "Reply", exact: true }).click();
    const replyForm = adminCard.locator("form");
    await replyForm.getByRole("textbox", { name: "Post your reply" }).fill(replyText);
    await replyForm.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(replyForm).toHaveCount(0);
    await adminCard.getByRole("button", { name: "Open thread", exact: true }).click();
    await expect(adminPulse.getByRole("heading", { name: "Thread" })).toBeVisible();
    const replies = adminPulse.getByRole("region", { name: "Replies" });
    await expect(noteCard(adminPulse, noteText)).toBeVisible();
    await expect(noteCard(replies, replyText)).toBeVisible();
    const threadRoot = noteCard(adminPulse, noteText);
    await expect(threadRoot.getByTestId("pulse-like-count")).toHaveText("1");
    await expect(threadRoot.getByRole("button", { name: "Unlike", exact: true })).toBeVisible();
    await screenshot(adminSession.page, "desktop-thread");
    await adminPulse.getByRole("button", { name: "Back", exact: true }).click();

    // Member's thread view receives the reply too.
    await noteCard(memberPulse, noteText).getByRole("button", { name: "Open thread" }).click();
    await expect(
      noteCard(memberPulse.getByRole("region", { name: "Replies" }), replyText),
    ).toBeVisible();
    await memberPulse.getByRole("button", { name: "Back", exact: true }).click();

    // Admin opens the author's profile, follows, and returns.
    const authorButton = noteCard(adminPulse, noteText).getByRole("button").first();
    const authorName = (await authorButton.textContent())?.trim() ?? "";
    await authorButton.click();
    await expect(adminPulse.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(adminPulse.getByRole("heading", { name: authorName, exact: true })).toBeVisible();
    await expect(noteCard(adminPulse, noteText)).toBeVisible();
    await adminPulse.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(adminPulse.getByRole("button", { name: "Unfollow", exact: true })).toBeVisible();
    await screenshot(adminSession.page, "desktop-profile");
    await adminPulse.getByRole("button", { name: "Back", exact: true }).click();
    await expect(adminPulse.getByRole("heading", { name: "Pulse", exact: true })).toBeVisible();

    const followed = follows(await latestContacts(relay, admin.pubkey));
    expect(followed).toContain(member.pubkey);
    // The follow was a read-modify-write: the pre-existing follows survive.
    for (const pubkey of [...follows(baseline), lateFollow]) expect(followed).toContain(pubkey);

    await adminPulse.getByRole("tab", { name: "Following" }).click();
    await expect(noteCard(adminPulse, noteText)).toBeVisible();

    // Admin posts a note mentioning the member (picked from the follow-based
    // suggestions, as on desktop) with an uploaded image.
    const mentionMarker = `Pulse mention ${randomUUID()}`;
    const composerBox = adminPulse.getByRole("textbox", { name: "What's on your mind?" });
    await composerBox.click();
    await composerBox.pressSequentially(`@${authorName.split(" ")[0]}`);
    await adminPulse
      .getByRole("listbox", { name: "Mention suggestions" })
      .getByRole("option", { name: new RegExp(escapeRegExp(authorName)) })
      .click();
    await expect(composerBox).toHaveValue(`@${authorName} `);
    await composerBox.press("End");
    await composerBox.pressSequentially(mentionMarker);
    const composerForm = adminPulse.locator("form").filter({
      has: adminSession.page.getByRole("textbox", { name: "What's on your mind?" }),
    });
    await composerForm.locator('input[type="file"]').setInputFiles({
      name: "pulse-pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(PIXEL_PNG_BASE64, "base64"),
    });
    await expect(composerForm.getByTestId("composer-attachments")).toContainText("pulse-pixel.png");
    await composerForm.getByRole("button", { name: "Post", exact: true }).click();
    await expect(composerBox).toHaveValue("");

    const [mentionNote] = (
      await retryRateLimited(() =>
        relay.waitFor([{ kinds: [1], authors: [admin.pubkey], limit: 20 }], (events) =>
          events.some((event) => event.content.includes(mentionMarker)),
        ),
      )
    ).filter((event) => event.content.includes(mentionMarker));
    expect(mentionNote.content.startsWith(`@${authorName} ${mentionMarker}`)).toBe(true);
    expect(mentionNote.tags).toContainEqual(["p", member.pubkey]);
    expect(mentionNote.tags.some((tag) => tag[0] === "h")).toBe(false);
    const imeta = mentionNote.tags.find((tag) => tag[0] === "imeta");
    expect(imeta).toContain("filename pulse-pixel.png");
    expect(imeta?.some((entry) => entry.startsWith("m image/"))).toBe(true);

    // The member's open Pulse receives it live and renders the uploaded image.
    const memberPill = memberPulse.getByRole("button", { name: /^\d+ new notes?$/ });
    const mentionCard = memberPulse.getByRole("article").filter({ hasText: mentionMarker });
    await expect(memberPill.or(mentionCard)).toBeVisible();
    if (await memberPill.isVisible()) await memberPill.click();
    const memberImage = mentionCard.getByRole("img", { name: "pulse-pixel.png" });
    await expect(memberImage).toBeVisible();
    await expect
      .poll(() => memberImage.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await screenshot(memberSession.page, "desktop-mention-image");

    // Liked tab lists the note; unliking removes the like everywhere.
    await adminPulse.getByRole("tab", { name: "Liked" }).click();
    const likedCard = noteCard(adminPulse, noteText);
    await expect(likedCard).toBeVisible();
    await likedCard.getByRole("button", { name: "Unlike", exact: true }).click();
    await expect(likedCard.getByRole("button", { name: "Like", exact: true })).toBeVisible();
    await expect(noteCard(memberPulse, noteText).getByTestId("pulse-like-count")).toHaveCount(0);

    // Client-side search over loaded notes.
    await memberPulse.getByRole("tab", { name: "Search Pulse" }).click();
    await memberPulse.getByRole("searchbox", { name: "Search Pulse" }).fill(noteText);
    await expect(noteCard(memberPulse, noteText)).toBeVisible();
    await memberPulse.getByRole("tab", { name: "Everyone" }).click();

    const mobile = memberSession.page;
    await mobile.setViewportSize({ width: 390, height: 844 });
    await expect(mobile.getByRole("button", { name: "More tools", exact: true })).toBeVisible();
    await expect(noteCard(memberPulse, noteText)).toBeVisible();
    // Let the shell's drawer transition settle so the capture shows the final layout.
    await mobile.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );
    await screenshot(mobile, "mobile-feed");
    await noteCard(memberPulse, noteText).getByRole("button", { name: "Open thread" }).click();
    await expect(memberPulse.getByRole("heading", { name: "Thread" })).toBeVisible();
    await expect(
      noteCard(memberPulse.getByRole("region", { name: "Replies" }), replyText),
    ).toBeVisible();
    await screenshot(mobile, "mobile-thread");
  } catch (error) {
    await screenshot(adminSession.page, "failure-admin");
    await screenshot(memberSession.page, "failure-member");
    throw error;
  } finally {
    await adminSession.context.close();
    await memberSession.context.close();
    // Restore the admin's contact list as it was before the run.
    const current = await latestContacts(relay, admin.pubkey);
    await publishAdmin({
      kind: 3,
      created_at: Math.max(Math.floor(Date.now() / 1000), (current?.created_at ?? 0) + 1),
      content: original?.content ?? "",
      tags: original?.tags ?? [],
    });
    relay.close();
  }
});
