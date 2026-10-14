import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { crc32 } from "node:zlib";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { type NostrEvent, verifyEvent } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import {
  addMember,
  archiveChannel,
  browserEnvironment,
  createPrivateChannel,
  identityFromEnvironment,
  importIdentity,
  type LiveIdentity,
  liveRelayUrl,
  reloadAndUnlock,
} from "./support/live-session";
import { NodeRelayClient } from "./support/node-relay";

const evidenceDir = process.env.COLLAB_EVIDENCE_DIR;
const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");

test.use({ launchOptions: { env: browserEnvironment() } });

async function openSession(browser: Browser, identity: LiveIdentity, mobile = false) {
  const context = await browser.newContext({
    acceptDownloads: true,
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

async function channelIdByName(relay: NodeRelayClient, name: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await relay
      .query([{ kinds: [39000], since: Math.floor(Date.now() / 1000) - 600, limit: 200 }])
      .catch(() => []);
    const match = events.find((event) =>
      event.tags.some((tag) => tag[0] === "name" && tag[1] === name),
    );
    const id = match?.tags.find((tag) => tag[0] === "d")?.[1];
    if (id) return id;
    await sleep(1000);
  }
  throw new Error(`channel ${name} not found`);
}

/** Publish a channel message, waiting out the relay's per-identity rate limit when it applies. */
async function publishMessage(
  relay: NodeRelayClient,
  identity: LiveIdentity,
  channelId: string,
  content: string,
  extraTags: string[][] = [],
): Promise<NostrEvent> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await relay.publish(
        {
          kind: 9,
          created_at: Math.floor(Date.now() / 1000),
          content,
          tags: [["h", channelId], ...extraTags],
        },
        identity.secretKey,
      );
    } catch (error) {
      if (attempt >= 10 || !String(error).includes("rate-limited")) throw error;
      await sleep(3000);
    }
  }
}

async function openExportSettings(page: Page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  const settings = page.getByTestId("workspace-tool-settings");
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Export", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Export", exact: true })).toBeVisible();
  return settings;
}

test("member exports only the selected channel as a verifiable archive", async ({ browser }) => {
  const suffix = randomUUID().slice(0, 8);
  const targetName = `export-target-${suffix}`;
  const otherName = `export-hidden-${suffix}`;
  const marker = `HIDDEN-MARKER-${randomUUID()}`;
  const known = [`export known one ${suffix}`, `export known two ${suffix}`];
  const memberRelay = await NodeRelayClient.connect(liveRelayUrl(), member.secretKey);
  const adminRelay = await NodeRelayClient.connect(liveRelayUrl(), admin.secretKey);
  const adminSession = await openSession(browser, admin);
  const memberSession = await openSession(browser, member);
  const { page } = memberSession;
  try {
    await createPrivateChannel(adminSession.page, otherName);
    const otherId = await channelIdByName(adminRelay, otherName);
    await publishMessage(adminRelay, admin, otherId, marker);

    await createPrivateChannel(adminSession.page, targetName);
    await addMember(adminSession.page, member.pubkey);
    const targetId = await channelIdByName(adminRelay, targetName);
    await reloadAndUnlock(page, member);
    const posted: NostrEvent[] = [];
    for (const content of known)
      posted.push(await publishMessage(memberRelay, member, targetId, content));
    const reply = await publishMessage(memberRelay, member, targetId, `thread reply ${suffix}`, [
      ["e", posted[0].id, "", "reply"],
    ]);
    // Buzz reactions carry only e/p tags (no h); the relay scopes them by their target.
    let reaction: NostrEvent | undefined;
    for (let attempt = 0; !reaction; attempt += 1) {
      try {
        reaction = await adminRelay.publish(
          {
            kind: 7,
            created_at: Math.floor(Date.now() / 1000),
            content: "🎉",
            tags: [
              ["e", posted[0].id],
              ["p", member.pubkey],
            ],
          },
          admin.secretKey,
        );
      } catch (error) {
        if (attempt >= 10 || !String(error).includes("rate-limited")) throw error;
        await sleep(3000);
      }
    }
    if (!reaction) throw new Error("reaction was not published");

    const settings = await openExportSettings(page);
    const target = settings.getByRole("checkbox", { name: new RegExp(targetName) });
    await expect(target).toBeVisible();
    await expect(settings.getByRole("checkbox", { name: new RegExp(otherName) })).toHaveCount(0);
    await target.check();
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/export-desktop.png` });
    const downloadPromise = page.waitForEvent("download");
    await settings.getByRole("button", { name: "Download archive (1)" }).click();
    const download = await downloadPromise;
    await expect(settings.getByText(/Downloaded 1 channels/)).toBeVisible();
    const path = await download.path();
    const files = unzipSync(new Uint8Array(await readFile(path)));

    const names = Object.keys(files).sort();
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.format).toBe("buzz-web-content-export");
    expect(manifest.exporterPubkey).toBe(member.pubkey);
    expect(manifest.channels.map((channel: { id: string }) => channel.id)).toEqual([targetId]);
    const directory = manifest.channels[0].directory as string;
    expect(names).toEqual(
      ["manifest.json", `${directory}/events.json`, `${directory}/messages.md`].sort(),
    );

    const events = JSON.parse(strFromU8(files[`${directory}/events.json`])) as NostrEvent[];
    for (const expected of [...posted, reply]) {
      const found = events.find((event) => event.id === expected.id);
      expect(found?.content).toBe(expected.content);
    }
    const invalid = events.filter((event) => !verifyEvent({ ...event }));
    expect(invalid).toEqual([]);
    const exportedIds = new Set(events.map((event) => event.id));
    for (const event of events) {
      const inChannel = event.tags.some((tag) => tag[0] === "h" && tag[1] === targetId);
      const targetsExported =
        [5, 7].includes(event.kind) &&
        event.tags.some((tag) => tag[0] === "e" && exportedIds.has(tag[1]));
      expect(inChannel || targetsExported).toBe(true);
    }
    const exportedReaction = events.find((event) => event.id === reaction.id);
    expect(exportedReaction?.pubkey).toBe(admin.pubkey);

    const everything = names.map((name) => strFromU8(files[name])).join("\n");
    expect(everything).not.toContain(marker);
    expect(everything).not.toContain(otherId);
    for (const identity of [admin, member]) {
      expect(everything).not.toContain(identity.nsec);
      expect(everything).not.toContain(bytesToHex(identity.secretKey));
    }
    expect(everything).not.toContain("nsec1");
    const markdown = strFromU8(files[`${directory}/messages.md`]);
    expect(markdown).toContain(`# ${targetName}`);
    for (const content of known) expect(markdown).toContain(content);
    expect(markdown).toContain(`> thread reply ${suffix}`);
    expect(markdown).toContain("Reactions: 🎉 1");
    expect(markdown).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);

    if (evidenceDir) {
      await writeFile(
        `${evidenceDir}/export-validation.json`,
        `${JSON.stringify(
          {
            zipEntries: names.map((name) => ({ name, bytes: files[name].length })),
            manifest,
            eventCount: events.length,
            signaturesValid: invalid.length === 0,
            knownMessagesPresent: true,
            otherChannelMarkerAbsent: true,
            secretKeysAbsent: true,
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(`${evidenceDir}/export-messages.md`, markdown);
    }

    const mobile = await openSession(browser, member, true);
    try {
      const mobileSettings = await openExportSettings(mobile.page);
      await mobileSettings.getByRole("checkbox", { name: new RegExp(targetName) }).check();
      if (evidenceDir) await mobile.page.screenshot({ path: `${evidenceDir}/export-mobile.png` });
    } finally {
      await mobile.context.close();
    }

    await archiveChannel(adminSession.page, targetName);
    await archiveChannel(adminSession.page, otherName);
  } finally {
    memberRelay.close();
    adminRelay.close();
    await memberSession.context.close();
    await adminSession.context.close();
  }
});

type PngChunkInfo = { type: string; crcValid: boolean; text?: { keyword: string; value: string } };

/** Independent PNG walk: signature, chunk order, CRC-32 per chunk, Latin-1 tEXt payloads. */
function parsePngCard(bytes: Buffer): PngChunkInfo[] {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: PngChunkInfo[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const crc = bytes.readUInt32BE(offset + 8 + length);
    const info: PngChunkInfo = {
      type,
      crcValid: crc32(bytes.subarray(offset + 4, offset + 8 + length)) === crc,
    };
    if (type === "tEXt") {
      const separator = data.indexOf(0);
      info.text = {
        keyword: data.toString("latin1", 0, separator),
        value: data.toString("latin1", separator + 1),
      };
    }
    chunks.push(info);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function personaRow(page: Page, name: string) {
  return page.getByTestId("agent-personas").locator("li").filter({ hasText: name });
}

async function exportPersona(page: Page, name: string, format: "PNG card" | "JSON") {
  await personaRow(page, name).getByRole("button", { name: "Export agent snapshot" }).click();
  const menu = page.getByRole("menu", { name: "File format" });
  await expect(menu).toBeVisible();
  if (format === "PNG card" && evidenceDir) {
    await page.screenshot({ path: `${evidenceDir}/export-snapshot-menu.png` });
  }
  const downloadPromise = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: format }).click();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test("persona snapshot round-trips through the Agents UI as PNG card and JSON", async ({
  browser,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Snapshot Probe ${suffix}`;
  const instructions = `Answer export probe ${suffix}.\n\tStay concise.`;
  const session = await openSession(browser, member);
  const { page } = session;
  try {
    await page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("button", { name: "Agents" })
      .click();
    const view = page.getByTestId("workspace-tool-agents");
    await expect(view).toBeVisible();
    await view.getByRole("tab", { name: "Personas" }).click();
    await view.getByRole("button", { name: "New persona" }).click();
    const editor = page.getByRole("dialog", { name: "New persona" });
    await editor.getByLabel("Name", { exact: true }).fill(name);
    await editor.getByLabel("Model", { exact: true }).fill("claude-opus-4");
    await editor.getByLabel("Description", { exact: true }).fill(`Probe ${suffix}`);
    await editor.getByLabel("Instructions", { exact: true }).fill(instructions);
    await editor.getByRole("button", { name: "Save persona" }).click();
    await expect(personaRow(page, name)).toHaveCount(1, { timeout: 30_000 });

    const png = await exportPersona(page, name, "PNG card");
    expect(png.name).toBe(`snapshot-probe-${suffix}.agent.png`);
    const chunks = parsePngCard(png.bytes);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "tEXt", "IDAT", "IEND"]);
    expect(chunks.every((chunk) => chunk.crcValid)).toBe(true);
    const text = chunks[1].text;
    expect(text?.keyword).toBe("buzz_agent_snapshot");
    const manifestJson = Buffer.from(text?.value ?? "", "base64").toString("utf8");
    const manifest = JSON.parse(manifestJson);
    expect(manifest).toMatchObject({
      format: "buzz-agent-snapshot",
      version: 1,
      definition: { name, systemPrompt: instructions, model: "claude-opus-4" },
      profile: { displayName: name, about: `Probe ${suffix}` },
      memory: { level: "none" },
    });

    const json = await exportPersona(page, name, "JSON");
    expect(json.name).toBe(`snapshot-probe-${suffix}.agent.json`);
    expect(JSON.parse(json.bytes.toString("utf8"))).toEqual(manifest);

    const everything = `${png.bytes.toString("latin1")}\n${manifestJson}\n${json.bytes.toString("utf8")}`;
    expect(everything).not.toContain("nsec1");
    for (const identity of [admin, member]) {
      expect(everything).not.toContain(bytesToHex(identity.secretKey));
    }

    await view
      .locator('input[type="file"][accept*=".png"]')
      .setInputFiles({ name: png.name, mimeType: "image/png", buffer: png.bytes });
    await expect(page.getByText("Imported 1 as private")).toBeVisible({ timeout: 30_000 });
    await expect(personaRow(page, name)).toHaveCount(2, { timeout: 30_000 });
    if (evidenceDir) {
      await page.screenshot({ path: `${evidenceDir}/export-snapshot-imported.png` });
      await writeFile(`${evidenceDir}/export-snapshot-${suffix}.agent.png`, png.bytes);
      await writeFile(`${evidenceDir}/export-snapshot-${suffix}.agent.json`, json.bytes);
      await writeFile(
        `${evidenceDir}/export-snapshot-validation.json`,
        `${JSON.stringify(
          {
            pngFile: png.name,
            pngBytes: png.bytes.length,
            chunks: chunks.map(({ type, crcValid, text: chunkText }) => ({
              type,
              crcValid,
              ...(chunkText
                ? { keyword: chunkText.keyword, base64Length: chunkText.value.length }
                : {}),
            })),
            manifest,
            jsonFile: json.name,
            jsonMatchesPngManifest: true,
            secretsAbsent: true,
            importedPersonaRows: 2,
          },
          null,
          2,
        )}\n`,
      );
    }
  } finally {
    for (let remaining = await personaRow(page, name).count(); remaining > 0; remaining -= 1) {
      const row = personaRow(page, name).first();
      await row.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
      await row.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(personaRow(page, name)).toHaveCount(remaining - 1, { timeout: 30_000 });
    }
    await expect(personaRow(page, name)).toHaveCount(0, { timeout: 30_000 });
    await session.context.close();
  }
});
