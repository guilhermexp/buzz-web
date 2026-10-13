import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { nip19 } from "nostr-tools";
import type { DecodedResult } from "nostr-tools/nip19";
import { getPublicKey } from "nostr-tools/pure";

export type LiveIdentity = {
  nsec: string;
  pubkey: string;
  secretKey: Uint8Array;
  vaultPassphrase: string;
};

/** Dedicated test identity injected by the operator's secret store; never logged. */
export function identityFromEnvironment(name: string): LiveIdentity {
  const nsec = process.env[name]?.trim();
  if (!nsec) throw new Error(`${name} is required for live Relay acceptance tests.`);
  let decoded: DecodedResult;
  try {
    decoded = nip19.decode(nsec);
  } catch {
    throw new Error(`${name} must contain a valid dedicated test identity.`);
  }
  if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) {
    throw new Error(`${name} must contain a valid dedicated test identity.`);
  }
  return {
    nsec,
    pubkey: getPublicKey(decoded.data),
    secretKey: decoded.data,
    vaultPassphrase: randomBytes(24).toString("base64url"),
  };
}

export function liveRelayUrl(): string {
  const value = process.env.BUZZ_LIVE_RELAY_URL?.trim();
  if (!value) throw new Error("BUZZ_LIVE_RELAY_URL is required for live Relay acceptance tests.");
  return value.replace(/\/$/, "");
}

/** Process environment for launched browsers, without the injected identities. */
export function browserEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].endsWith("_NSEC"),
    ),
  );
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

export async function importIdentity(page: Page, identity: LiveIdentity) {
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

export async function reloadAndUnlock(page: Page, identity: LiveIdentity) {
  await page.reload();
  await page.getByLabel("Vault passphrase").fill(identity.vaultPassphrase);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("button", { name: "Profile menu" })).toBeVisible();
  await waitForRelay(page);
}

export async function createPrivateChannel(page: Page, channelName: string) {
  await page.getByRole("button", { name: "Browse channels" }).click();
  const browser = page.getByRole("dialog", { name: "Browse channels" });
  await browser.getByRole("button", { name: "Create", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create channel" });
  await create.getByLabel("Name").fill(channelName);
  await create.getByLabel("Description").fill("Automated voice acceptance; safe to archive.");
  await create.getByLabel("Type").selectOption("stream");
  await create.getByLabel("Visibility").selectOption("private");
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: channelName, exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

export async function openChannel(page: Page, channelName: string) {
  const channel = page.getByRole("button", { name: channelName, exact: true });
  await expect(channel).toBeVisible({ timeout: 30_000 });
  await channel.click();
  await expect(page.getByRole("heading", { name: channelName, exact: true })).toBeVisible();
}

export async function addMember(page: Page, pubkey: string) {
  const opener = page.getByRole("button", { name: /^Members: \d+$/ });
  const before = Number((await opener.getAttribute("aria-label"))?.match(/\d+/)?.[0] ?? "NaN");
  await opener.click();
  const members = page.getByRole("dialog", { name: /Members · / });
  await members.getByRole("button", { name: "Add member", exact: true }).click();
  await members.getByLabel("Member public key", { exact: true }).fill(pubkey);
  await members.getByLabel("Role", { exact: true }).selectOption("member");
  await members.getByRole("button", { name: "Add member", exact: true }).last().click();
  await expect(page.getByRole("dialog", { name: `Members · ${before + 1}` })).toBeVisible({
    timeout: 30_000,
  });
  await members.getByRole("button", { name: "Close", exact: true }).click();
}

export async function removeMember(page: Page, displayName: string) {
  await page.getByRole("button", { name: /^Members: \d+$/ }).click();
  const members = page.getByRole("dialog", { name: /Members · / });
  await members.getByRole("button", { name: `Remove ${displayName}`, exact: true }).click();
  await page
    .getByRole("dialog", { name: "Remove member" })
    .getByRole("button", { name: "Remove member", exact: true })
    .click();
  await expect(
    members.getByRole("button", { name: `Remove ${displayName}`, exact: true }),
  ).toHaveCount(0, { timeout: 30_000 });
  await members.getByRole("button", { name: "Close", exact: true }).click();
}

export async function archiveChannel(page: Page, channelName: string) {
  await page.keyboard.press("Escape");
  await openChannel(page, channelName);
  await page.getByRole("button", { name: "Channel details" }).click();
  const details = page.getByRole("complementary", { name: "Channel details" });
  await details.getByRole("button", { name: "Archive channel" }).click();
  await page
    .getByRole("dialog", { name: "Archive channel" })
    .getByRole("button", { name: "Archive channel" })
    .click();
  await expect(page.getByRole("button", { name: channelName, exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
}
