import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  addMember,
  archiveChannel,
  createPrivateChannel,
  identityFromEnvironment,
  importIdentity,
  liveRelayUrl,
  openChannel,
  reloadAndUnlock,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

// Real-Relay canvas acceptance: two identities edit one private channel's
// canvas (kind 40100) through the browser UI; the Relay's compare-and-swap
// decides which write wins. Relay-side assertions use NodeRelayClient.

const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");

const V1 = "# Launch plan\n\n- owner: admin\n- scope: web\n- status: draft\n";
const A_REVIEW = V1.replace("status: draft", "status: review");
const B_STALE_DRAFT = V1.replace("owner: admin", "owner: member");
const MERGED = "# Launch plan\n\n- owner: member\n- scope: web\n- status: review\n";
const B_BLOCKED = MERGED.replace("status: review", "status: blocked");
const A_SHIPPED = MERGED.replace("status: review", "status: shipped");

function evidence(name: string) {
  const dir = process.env.COLLAB_EVIDENCE_DIR;
  return dir ? `${dir}/canvas-${name}.png` : test.info().outputPath(`canvas-${name}.png`);
}

const canvasPanel = (page: Page) => page.getByRole("complementary", { name: "Canvas" });
const editor = (page: Page) => canvasPanel(page).getByRole("textbox", { name: "Canvas content" });

async function openCanvas(page: Page) {
  const toggle = page.getByRole("button", { name: "Canvas", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(canvasPanel(page)).toBeVisible();
}

async function saveCanvas(page: Page) {
  await canvasPanel(page).getByRole("button", { name: "Save canvas" }).click();
}

test("canvas compare-and-swap, merge, history, restore and private access", async ({ browser }) => {
  const relayUrl = liveRelayUrl();
  const channelName = `web-canvas-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const contexts: BrowserContext[] = [];
  const newPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(context);
    return context.newPage();
  };
  const adminPage = await newPage();
  const memberPage = await newPage();
  const relay = await NodeRelayClient.connect(relayUrl, admin.secretKey);
  let channelCreated = false;
  let channelId: string | null = null;

  try {
    await importIdentity(adminPage, admin);
    await importIdentity(memberPage, member);
    await createPrivateChannel(adminPage, channelName);
    channelCreated = true;
    await addMember(adminPage, member.pubkey);
    await reloadAndUnlock(memberPage, member);
    await openChannel(memberPage, channelName);

    // A plain member gets an honest read-only empty state: no Create.
    await openCanvas(memberPage);
    await expect(
      canvasPanel(memberPage).getByText("No canvas set for this channel."),
    ).toBeVisible();
    await expect(
      canvasPanel(memberPage).getByText("Only channel owners and admins can edit this canvas."),
    ).toBeVisible();
    await expect(
      canvasPanel(memberPage).getByRole("button", { name: "Create canvas" }),
    ).toHaveCount(0);

    // First write by the channel owner from the empty state.
    await openCanvas(adminPage);
    await expect(canvasPanel(adminPage).getByText("No canvas yet")).toBeVisible();
    await canvasPanel(adminPage).getByRole("button", { name: "Create canvas" }).click();
    await editor(adminPage).fill(V1);
    await saveCanvas(adminPage);
    await expect(
      canvasPanel(adminPage).getByRole("heading", { name: "Launch plan" }),
    ).toBeVisible();
    await expect(canvasPanel(adminPage).getByText("status: draft")).toBeVisible();
    const [created] = await relay.waitFor(
      [{ kinds: [40100], authors: [admin.pubkey], limit: 5 }],
      (events) => events.some((event) => event.content === V1),
    );
    channelId = created?.tags.find((tag) => tag[0] === "h")?.[1] ?? null;
    expect(channelId).toBeTruthy();

    // The plain member receives the head live but still has no edit control.
    await expect(canvasPanel(memberPage).getByText("status: draft")).toBeVisible();
    await expect(canvasPanel(memberPage).getByRole("button", { name: "Edit canvas" })).toHaveCount(
      0,
    );
    await memberPage.screenshot({ path: evidence("desktop-member-readonly") });

    // Promote the member to channel admin so both identities may write.
    await relay.publish(
      {
        kind: 9000,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["h", channelId as string],
          ["p", member.pubkey],
          ["role", "admin"],
        ],
      },
      admin.secretKey,
    );
    await reloadAndUnlock(memberPage, member);
    await openChannel(memberPage, channelName);

    // Both writers load the same head; the second admin edits first but saves second.
    await openCanvas(memberPage);
    await expect(canvasPanel(memberPage).getByText("status: draft")).toBeVisible();
    await canvasPanel(memberPage).getByRole("button", { name: "Edit canvas" }).click();
    await editor(memberPage).fill(B_STALE_DRAFT);

    await canvasPanel(adminPage).getByRole("button", { name: "Edit canvas" }).click();
    await editor(adminPage).fill(A_REVIEW);
    await saveCanvas(adminPage);
    await expect(canvasPanel(adminPage).getByText("status: review")).toBeVisible();
    await adminPage.screenshot({ path: evidence("desktop-view") });

    // Live update while the member has unsaved edits: notice, draft untouched.
    await expect(
      canvasPanel(memberPage).getByText(/updated the canvas while you were editing/),
    ).toBeVisible();
    await expect(editor(memberPage)).toHaveValue(B_STALE_DRAFT);

    // Stale save: the Relay rejects it; the draft stays and the newer head shows.
    await saveCanvas(memberPage);
    await expect(
      canvasPanel(memberPage).getByRole("heading", {
        name: "This canvas changed since you loaded it",
      }),
    ).toBeVisible();
    const latest = canvasPanel(memberPage).getByRole("region", { name: "Latest canvas version" });
    await expect(latest.getByText("status: review")).toBeVisible();
    await expect(editor(memberPage)).toHaveValue(B_STALE_DRAFT);
    await memberPage.screenshot({ path: evidence("desktop-conflict") });

    // Merge: non-overlapping line edits combine cleanly; the member saves on the new head.
    await canvasPanel(memberPage).getByRole("button", { name: "Merge changes" }).click();
    await expect(editor(memberPage)).toHaveValue(MERGED);
    await expect(canvasPanel(memberPage).getByText(/Merged with the latest version/)).toBeVisible();
    await saveCanvas(memberPage);
    await expect(canvasPanel(memberPage).getByText("owner: member")).toBeVisible();
    await expect(canvasPanel(adminPage).getByText("owner: member")).toBeVisible();

    // Overwrite path: the admin's stale draft is rejected, then retried on the new head.
    await canvasPanel(adminPage).getByRole("button", { name: "Edit canvas" }).click();
    await editor(adminPage).fill(A_SHIPPED);
    await canvasPanel(memberPage).getByRole("button", { name: "Edit canvas" }).click();
    await editor(memberPage).fill(B_BLOCKED);
    await saveCanvas(memberPage);
    await expect(canvasPanel(memberPage).getByText("status: blocked")).toBeVisible();
    await saveCanvas(adminPage);
    await expect(
      canvasPanel(adminPage).getByRole("heading", {
        name: "This canvas changed since you loaded it",
      }),
    ).toBeVisible();
    await expect(editor(adminPage)).toHaveValue(A_SHIPPED);
    await canvasPanel(adminPage).getByRole("button", { name: "Overwrite with my draft" }).click();
    await expect(canvasPanel(adminPage).getByText("status: shipped")).toBeVisible();
    await expect(canvasPanel(memberPage).getByText("status: shipped")).toBeVisible();

    // History: every accepted revision, newest first; restore the first one.
    await canvasPanel(memberPage).getByRole("button", { name: "History", exact: true }).click();
    const history = canvasPanel(memberPage).getByRole("region", { name: "Canvas history" });
    // Direct children only: a revision preview renders its own Markdown list items.
    const rows = history.getByRole("list").first().locator(":scope > li");
    await expect(rows).toHaveCount(5);
    await expect(rows.first().getByText("Current")).toBeVisible();
    await rows.last().getByRole("button").first().click();
    await expect(rows.last().getByText("status: draft")).toBeVisible();
    await memberPage.screenshot({ path: evidence("desktop-history") });
    await rows.last().getByRole("button", { name: "Restore this revision" }).click();
    await expect(history.getByRole("heading", { name: "Restore this revision?" })).toBeVisible();
    await history.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(history.getByText("Revision restored.", { exact: false })).toBeVisible();
    await expect(rows).toHaveCount(6);
    await expect(canvasPanel(adminPage).getByText("status: draft")).toBeVisible();

    const revisions = await relay.waitFor(
      [{ kinds: [40100], "#h": [channelId as string], limit: 50 }],
      (events) => events.length === 6,
    );
    expect(revisions[0]?.content).toBe(V1);
    expect(revisions.map((event) => event.content)).toEqual([
      V1,
      A_SHIPPED,
      B_BLOCKED,
      MERGED,
      A_REVIEW,
      V1,
    ]);
    // The stale draft was never published.
    expect(revisions.some((event) => event.content === B_STALE_DRAFT)).toBe(false);

    // Mobile: the panel takes the full 390px width.
    await canvasPanel(memberPage).getByRole("button", { name: "History", exact: true }).click();
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const box = await canvasPanel(memberPage).boundingBox();
        return box ? [Math.round(box.x), Math.round(box.width)] : null;
      })
      .toEqual([0, 390]);
    // Let the navigation drawer finish its slide-out before capturing evidence.
    await memberPage.waitForTimeout(500);
    await expect(canvasPanel(memberPage).getByText("status: draft")).toBeVisible();
    await memberPage.screenshot({ path: evidence("mobile-view") });
    await memberPage.setViewportSize({ width: 1440, height: 900 });

    // Non-member: once removed, the open panel loses access and shows no content,
    // and the Relay discloses and accepts nothing for that identity.
    await relay.publish(
      {
        kind: 9001,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["h", channelId as string],
          ["p", member.pubkey],
        ],
      },
      admin.secretKey,
    );
    // The revoked subscription clears the content; if the shell keeps the
    // channel selected, the panel explains the missing access.
    await expect(memberPage.getByText("status: draft")).toHaveCount(0, { timeout: 30_000 });
    if (await canvasPanel(memberPage).getByText(`#${channelName}`).count()) {
      await expect(
        canvasPanel(memberPage).getByText(
          /No access to this canvas|This channel is no longer available/,
        ),
      ).toBeVisible();
    }
    await memberPage.screenshot({ path: evidence("desktop-no-access") });

    const outsider = await NodeRelayClient.connect(relayUrl, member.secretKey);
    try {
      await expect(
        outsider.query([{ kinds: [40100], "#h": [channelId as string], limit: 10 }]),
      ).rejects.toThrow(/restricted/);
      await expect(
        outsider.publish(
          {
            kind: 40100,
            created_at: Math.floor(Date.now() / 1000) + 2,
            content: "outsider edit",
            tags: [
              ["h", channelId as string],
              ["expected-revision", revisions[0]?.id ?? "none"],
            ],
          },
          member.secretKey,
        ),
      ).rejects.toThrow(/restricted/);
    } finally {
      outsider.close();
    }
    const [headAfter] = await relay.query([
      { kinds: [40100], "#h": [channelId as string], limit: 1 },
    ]);
    expect(headAfter?.id).toBe(revisions[0]?.id);
  } finally {
    if (channelCreated) {
      await canvasPanel(adminPage)
        .getByRole("button", { name: "Close canvas" })
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await archiveChannel(adminPage, channelName).catch(() => undefined);
    }
    relay.close();
    for (const context of contexts) await context.close();
  }
});
