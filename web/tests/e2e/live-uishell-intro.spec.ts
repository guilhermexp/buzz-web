import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  archiveChannel,
  createPrivateChannel,
  identityFromEnvironment,
  importIdentity,
  openChannel,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

/**
 * Channel intro flows against a real Relay: "Add people" and "Add agent"
 * publish NIP-29 put-user (kind 9000) and the relay-signed roster (39002)
 * reflects them; a write the Relay rejects (an agent whose kind 10100
 * `channel_add_policy` is "nobody") surfaces the rejection without any
 * optimistic success. A plain member may add too (relay put-user rule) but is
 * never offered an elevated role.
 */
const relayA = (process.env.BUZZ_LIVE_RELAY_URL ?? "ws://127.0.0.1:47300").replace(/\/$/, "");
const evidenceDir = process.env.BUZZ_LIVE_EVIDENCE_DIR;
const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");

async function evidence(page: Page, name: string) {
  if (!evidenceDir) return;
  await page.screenshot({ path: `${evidenceDir}/${name}.png`, animations: "disabled" });
}

function rosterRole(roster: { tags: string[][] } | undefined, pubkey: string): string | null {
  const tag = roster?.tags.find((entry) => entry[0] === "p" && entry[1] === pubkey);
  return tag ? (tag[3] ?? "member") : null;
}

/** Publishes a throwaway agent's kind 0 + kind 10100 from its own generated key. */
async function publishAgent(adminRelay: NodeRelayClient, name: string, policy: string) {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const now = () => Math.floor(Date.now() / 1_000);
  let agentRelay = await NodeRelayClient.connect(relayA, secretKey);
  const profile = async () => {
    await agentRelay.publish(
      { kind: 0, created_at: now(), content: JSON.stringify({ name, bot: true }), tags: [] },
      secretKey,
    );
    await agentRelay.publish(
      {
        kind: 10100,
        created_at: now(),
        content: JSON.stringify({
          name,
          display_name: name,
          agent_type: "acceptance",
          respond_to: "owner-only",
          channel_add_policy: policy,
        }),
        tags: [],
      },
      secretKey,
    );
  };
  try {
    await profile();
  } catch {
    // A closed community only accepts events from members: admit the throwaway
    // agent (NIP-43 kind 9030 by the relay admin) and retry once.
    agentRelay.close();
    await adminRelay.publish(
      {
        kind: 9030,
        created_at: now(),
        content: "",
        tags: [
          ["p", pubkey],
          ["role", "member"],
        ],
      },
      admin.secretKey,
    );
    agentRelay = await NodeRelayClient.connect(relayA, secretKey);
    await profile();
  }
  agentRelay.close();
  return pubkey;
}

test("channel intro adds people and agents through real, permission-aware writes", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const runId = randomBytes(4).toString("hex");
  const channelName = `uishell-intro-${runId}`;
  const agentName = `Intro agent ${runId}`;
  const lockedAgentName = `Locked agent ${runId}`;
  const memberAgentName = `Member agent ${runId}`;
  const adminRelay = await NodeRelayClient.connect(relayA, admin.secretKey);
  const adminContext = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });
  const memberContext = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });
  const page = await adminContext.newPage();
  const memberPage = await memberContext.newPage();
  let channelCreated = false;

  try {
    const [agentPubkey, lockedAgentPubkey, memberAgentPubkey] = [
      await publishAgent(adminRelay, agentName, "anyone"),
      await publishAgent(adminRelay, lockedAgentName, "nobody"),
      await publishAgent(adminRelay, memberAgentName, "anyone"),
    ];

    await importIdentity(page, admin);
    await createPrivateChannel(page, channelName);
    channelCreated = true;
    const metadata = await adminRelay.waitFor([{ kinds: [39000], limit: 500 }], (events) =>
      events.some((event) => event.tags.some((tag) => tag[0] === "name" && tag[1] === channelName)),
    );
    const channelId =
      metadata
        .find((event) => event.tags.some((tag) => tag[0] === "name" && tag[1] === channelName))
        ?.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    expect(channelId).not.toBe("");
    const roster = async () =>
      (await adminRelay.query([{ kinds: [39002], "#d": [channelId], limit: 1 }])).sort(
        (left, right) => right.created_at - left.created_at,
      )[0];

    const intro = page.getByTestId("message-channel-intro");
    await expect(intro).toBeVisible({ timeout: 30_000 });
    await evidence(page, "intro-admin");

    // (a) Add people: kind 9000 for the member; the relay roster lists them.
    await intro.getByRole("button", { name: /^Add people/ }).click();
    const members = page.getByRole("dialog", { name: /Members · / });
    await members.getByLabel("Member public key", { exact: true }).fill(member.pubkey);
    await members.getByLabel("Role", { exact: true }).selectOption("member");
    await members.getByRole("button", { name: "Add member", exact: true }).last().click();
    await expect(page.getByRole("dialog", { name: "Members · 2" })).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(async () => rosterRole(await roster(), member.pubkey)).toBe("member");
    await members.getByRole("button", { name: "Close" }).click();

    // (b) Add agent: discovered via kind 10100, added as role "bot".
    await intro.getByRole("button", { name: /^Add agent/ }).click();
    const addAgents = page.getByRole("dialog", { name: `Add agents to #${channelName}` });
    const addAgent = addAgents.getByRole("button", { name: `Add ${agentName}`, exact: true });
    await expect(addAgent).toBeVisible({ timeout: 30_000 });
    await addAgent.click();
    await expect(
      addAgents.getByRole("listitem").filter({ hasText: agentName }).getByText("In channel"),
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => rosterRole(await roster(), agentPubkey)).toBe("bot");
    const putUser = await adminRelay.query([
      { kinds: [9000], authors: [admin.pubkey], "#h": [channelId], "#p": [agentPubkey] },
    ]);
    console.log(`kind 9000 events for the agent visible to the admin: ${putUser.length}`);
    if (putUser.length) {
      expect(putUser[0]?.tags).toContainEqual(["role", "bot"]);
    }
    await evidence(page, "intro-add-agent-success");

    // (c) A write the Relay rejects: the alert names the rejection, the row keeps
    // its "Add" action (no optimistic success) and the roster is unchanged.
    const before = await roster();
    const addLocked = addAgents.getByRole("button", {
      name: `Add ${lockedAgentName}`,
      exact: true,
    });
    await expect(addLocked).toBeVisible({ timeout: 30_000 });
    await addLocked.click();
    const alert = addAgents.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    console.log(`rejection shown: ${(await alert.innerText()).slice(0, 160)}`);
    await expect(addLocked).toBeEnabled();
    await expect(
      addAgents.getByRole("listitem").filter({ hasText: lockedAgentName }).getByText("In channel"),
    ).toHaveCount(0);
    expect(rosterRole(await roster(), lockedAgentPubkey)).toBeNull();
    expect((await roster())?.id).toBe(before?.id);
    await evidence(page, "intro-add-agent-rejected");
    await addAgents.getByRole("button", { name: "Close" }).click();

    // A plain member may add as well, limited to non-elevated roles.
    await importIdentity(memberPage, member);
    await openChannel(memberPage, channelName);
    const memberIntro = memberPage.getByTestId("message-channel-intro");
    await expect(memberIntro).toBeVisible({ timeout: 30_000 });
    await memberIntro.getByRole("button", { name: /^Add people/ }).click();
    const memberDialog = memberPage.getByRole("dialog", { name: /Members · / });
    const roleSelect = memberDialog.getByLabel("Role", { exact: true });
    await expect(roleSelect.locator("option")).toHaveText(["Member", "Guest"]);
    await expect(memberDialog.locator('select[aria-label^="Change "]')).toHaveCount(0);
    await evidence(memberPage, "intro-member-add-people");
    await memberDialog.getByRole("button", { name: "Close" }).click();

    await memberIntro.getByRole("button", { name: /^Add agent/ }).click();
    const memberAgents = memberPage.getByRole("dialog", { name: `Add agents to #${channelName}` });
    const addMemberAgent = memberAgents.getByRole("button", {
      name: `Add ${memberAgentName}`,
      exact: true,
    });
    await expect(addMemberAgent).toBeVisible({ timeout: 30_000 });
    await addMemberAgent.click();
    await expect(
      memberAgents
        .getByRole("listitem")
        .filter({ hasText: memberAgentName })
        .getByText("In channel"),
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => rosterRole(await roster(), memberAgentPubkey)).toBe("bot");
    await evidence(memberPage, "intro-member-add-agent");
  } finally {
    if (channelCreated) await archiveChannel(page, channelName).catch(() => undefined);
    adminRelay.close();
    await memberContext.close();
    await adminContext.close();
  }
});
