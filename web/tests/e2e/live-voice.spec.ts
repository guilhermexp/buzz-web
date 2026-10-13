import { createHash, randomBytes } from "node:crypto";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import {
  decodeToMonoPcm,
  dominantFrequency,
  rmsDbfs,
  toneProminenceDb,
  writeGatedToneWav,
} from "./support/audio-analysis";
import {
  capturedTracks,
  installAudioProbe,
  liveCaptureTracks,
  playedToneProminence,
} from "./support/browser-audio-probe";
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
  removeMember,
} from "./support/live-session";
import { NativeHuddlePeer } from "./support/native-huddle-peer";
import { NodeRelayClient } from "./support/node-relay";

// Real-Relay voice acceptance. Audio input is SYNTHETIC: each Chromium instance
// captures a known gated tone through its fake capture device; the native-wire
// peer encodes its tone with libopus. This proves the browser capture → codec →
// authenticated Relay transport → decode → playout path, not a physical
// microphone/speaker or human listening.

const ADMIN_TONE = 440;
const MEMBER_TONE = 660;
const NATIVE_TONE = 880;
// Measured headroom (probe validation): played tones ≥ 55 dB, absent tones ≈ 5 dB.
const AUDIBLE_DB = 20;
const SILENT_DB = 10;

const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");
const member = identityFromEnvironment("BUZZ_LIVE_MEMBER_NSEC");
if (admin.pubkey === member.pubkey) {
  throw new Error("Live voice acceptance requires two distinct dedicated test identities.");
}

type VoiceClient = { browser: Browser; context: BrowserContext; page: Page };

async function launchVoiceClient(baseURL: string, tonePath: string): Promise<VoiceClient> {
  const browser = await chromium.launch({
    env: browserEnvironment(),
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${tonePath}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    baseURL,
    locale: "en-US",
    permissions: ["microphone"],
  });
  await installAudioProbe(context);
  return { browser, context, page: await context.newPage() };
}

function runIdentifier() {
  return `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function imetaFields(event: NostrEvent): Record<string, string>[] {
  return event.tags
    .filter((tag) => tag[0] === "imeta")
    .map((tag) => {
      const fields: Record<string, string> = {};
      for (const entry of tag.slice(1)) {
        const space = entry.indexOf(" ");
        if (space > 0) fields[entry.slice(0, space)] = entry.slice(space + 1);
      }
      return fields;
    });
}

async function blossomGet(url: string, secretKey: Uint8Array): Promise<Response> {
  const target = new URL(url);
  const auth = finalizeEvent(
    {
      kind: 24242,
      created_at: Math.floor(Date.now() / 1000),
      content: "Get media",
      tags: [
        ["t", "get"],
        ["expiration", String(Math.floor(Date.now() / 1000) + 300)],
        ["server", target.host],
      ],
    },
    secretKey,
  );
  const header = Buffer.from(JSON.stringify(auth)).toString("base64url");
  return fetch(target, { headers: { Authorization: `Nostr ${header}` } });
}

async function publishProfile(relayUrl: string, secretKey: Uint8Array, name: string) {
  const client = await NodeRelayClient.connect(relayUrl, secretKey);
  try {
    await client.publish(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify({ name, display_name: name }),
        tags: [],
      },
      secretKey,
    );
  } finally {
    client.close();
  }
}

test("voice notes record, cancel, upload and play real audio across clients", async () => {
  const testInfo = test.info();
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Live base URL is unavailable.");
  const relayUrl = liveRelayUrl();
  const runId = runIdentifier();
  const channelName = `web-voice-note-${runId}`;
  const startedAt = Math.floor(Date.now() / 1000) - 5;
  const adminTone = testInfo.outputPath("admin-tone.wav");
  const memberTone = testInfo.outputPath("member-tone.wav");
  await writeGatedToneWav(adminTone, ADMIN_TONE);
  await writeGatedToneWav(memberTone, MEMBER_TONE);
  const adminClient = await launchVoiceClient(baseURL, adminTone);
  const memberClient = await launchVoiceClient(baseURL, memberTone);
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

    // witness: voice_note_cancel_publishes_nothing
    await adminPage.getByRole("button", { name: "Record voice note" }).click();
    await expect(adminPage.getByRole("button", { name: "Discard voice note" })).toBeVisible();
    await expect.poll(() => liveCaptureTracks(adminPage)).toBe(1);
    await adminPage.waitForTimeout(1_500);
    await adminPage.getByRole("button", { name: "Discard voice note" }).click();
    await expect(adminPage.getByRole("button", { name: "Record voice note" })).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Remove voice note" })).toHaveCount(0);
    await expect.poll(() => liveCaptureTracks(adminPage)).toBe(0);
    expect(uploads).toHaveLength(0);

    // witness: voice_note_record_preview_send
    await adminPage.getByRole("button", { name: "Record voice note" }).click();
    await expect(adminPage.getByRole("button", { name: "Finish voice note" })).toBeEnabled();
    await adminPage.waitForTimeout(3_000);
    await adminPage.getByRole("button", { name: "Finish voice note" }).click();
    await expect(adminPage.getByRole("button", { name: "Remove voice note" })).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(() => liveCaptureTracks(adminPage)).toBe(0);
    await adminPage.getByRole("button", { name: "Play voice note" }).click();
    await expect(adminPage.getByRole("button", { name: "Pause voice note" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Send message" }).click();
    await expect(adminPage.getByRole("button", { name: "Remove voice note" })).toHaveCount(0, {
      timeout: 30_000,
    });
    expect(uploads).toHaveLength(1);

    // witness: voice_note_uploaded_audio_is_the_recorded_signal
    const reader = await NodeRelayClient.connect(relayUrl, member.secretKey);
    let voiceEvents: NostrEvent[] = [];
    try {
      voiceEvents = await reader.waitFor(
        [{ kinds: [9], authors: [admin.pubkey], since: startedAt }],
        (events) =>
          events.some((event) =>
            imetaFields(event).some((fields) => fields.filename?.startsWith("voice-note-")),
          ),
      );
    } finally {
      reader.close();
    }
    const voiceMessages = voiceEvents.filter((event) =>
      imetaFields(event).some((fields) => fields.filename?.startsWith("voice-note-")),
    );
    expect(voiceMessages).toHaveLength(1);
    const voice = imetaFields(voiceMessages[0] as NostrEvent).find((fields) =>
      fields.filename?.startsWith("voice-note-"),
    );
    expect(voice?.m).toMatch(/^audio\//);
    expect(voice?.url).toBeTruthy();
    const download = await blossomGet(String(voice?.url), member.secretKey);
    expect(download.status).toBe(200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(voice?.x);
    const samples = await decodeToMonoPcm(bytes);
    const seconds = samples.length / 48_000;
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(8);
    expect(Math.abs(dominantFrequency(samples) - ADMIN_TONE)).toBeLessThanOrEqual(10);

    // witness: voice_note_plays_in_second_client
    const received = memberPage.getByRole("button", { name: "Play voice note" });
    await expect(received).toHaveCount(1, { timeout: 30_000 });
    await received.click();
    await expect(memberPage.getByRole("button", { name: "Pause voice note" })).toBeVisible();
  } finally {
    if (channelCreated) await archiveChannel(adminPage, channelName).catch(() => undefined);
    await adminClient.browser.close();
    await memberClient.browser.close();
  }
});

test("huddle audio interoperates between browsers and a native-wire peer", async () => {
  const testInfo = test.info();
  test.setTimeout(300_000);
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Live base URL is unavailable.");
  const relayUrl = liveRelayUrl();
  const runId = runIdentifier();
  const channelName = `web-huddle-${runId}`;
  const startedAt = Math.floor(Date.now() / 1000) - 5;
  const nativeKey = generateSecretKey();
  const nativePubkey = getPublicKey(nativeKey);
  const memberName = `Voice Member ${runId}`;
  await publishProfile(relayUrl, member.secretKey, memberName);
  await publishProfile(relayUrl, nativeKey, `Native Peer ${runId}`);
  const adminTone = testInfo.outputPath("admin-tone.wav");
  const memberTone = testInfo.outputPath("member-tone.wav");
  await writeGatedToneWav(adminTone, ADMIN_TONE);
  await writeGatedToneWav(memberTone, MEMBER_TONE);
  const adminClient = await launchVoiceClient(baseURL, adminTone);
  const memberClient = await launchVoiceClient(baseURL, memberTone);
  const adminPage = adminClient.page;
  const memberPage = memberClient.page;
  let channelCreated = false;
  let native: NativeHuddlePeer | undefined;

  try {
    await importIdentity(adminPage, admin);
    await importIdentity(memberPage, member);
    await createPrivateChannel(adminPage, channelName);
    channelCreated = true;
    await addMember(adminPage, member.pubkey);
    await addMember(adminPage, nativePubkey);
    await reloadAndUnlock(memberPage, member);
    await openChannel(memberPage, channelName);

    // witness: huddle_start_and_join_through_relay
    await adminPage.getByRole("button", { name: "Start huddle" }).click();
    await expect(adminPage.getByRole("button", { name: "Leave huddle" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(adminPage.getByRole("button", { name: "Mute microphone" })).toBeVisible();
    const lookup = await NodeRelayClient.connect(relayUrl, nativeKey);
    let started: NostrEvent | undefined;
    try {
      [started] = await lookup.waitFor(
        [{ kinds: [48100], authors: [admin.pubkey], since: startedAt }],
        (events) => events.length > 0,
      );
    } finally {
      lookup.close();
    }
    const parentChannelId = started?.tags.find((tag) => tag[0] === "h")?.[1];
    const startedContent: unknown = JSON.parse(String(started?.content));
    const ephemeralChannelId =
      startedContent &&
      typeof startedContent === "object" &&
      "ephemeral_channel_id" in startedContent
        ? startedContent.ephemeral_channel_id
        : undefined;
    expect(parentChannelId).toBeTruthy();
    expect(ephemeralChannelId).toBeTruthy();
    native = await NativeHuddlePeer.join({
      relayUrl,
      ephemeralChannelId: String(ephemeralChannelId),
      parentChannelId: String(parentChannelId),
      secretKey: nativeKey,
    });
    const nativeStream = native.streamTone(NATIVE_TONE, 40);
    await memberPage.getByRole("button", { name: "Join huddle" }).click();
    await expect(memberPage.getByRole("button", { name: "Leave huddle" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      adminPage.getByRole("list", { name: "Huddle participants" }).getByRole("listitem"),
    ).toHaveCount(3, { timeout: 30_000 });

    // witness: huddle_bidirectional_known_audio
    await adminPage.waitForTimeout(3_000);
    const measureFrom = Date.now();
    const [atMember, atAdmin] = await Promise.all([
      playedToneProminence(memberPage, [ADMIN_TONE, NATIVE_TONE]),
      playedToneProminence(adminPage, [MEMBER_TONE, NATIVE_TONE]),
    ]);
    expect(atMember[ADMIN_TONE]).toBeGreaterThan(AUDIBLE_DB);
    expect(atMember[NATIVE_TONE]).toBeGreaterThan(AUDIBLE_DB);
    expect(atAdmin[MEMBER_TONE]).toBeGreaterThan(AUDIBLE_DB);
    expect(atAdmin[NATIVE_TONE]).toBeGreaterThan(AUDIBLE_DB);
    const fromAdmin = await native.decodeFrom(admin.pubkey, measureFrom);
    const fromMember = await native.decodeFrom(member.pubkey, measureFrom);
    expect(fromAdmin.frames).toBeGreaterThan(50);
    expect(fromMember.frames).toBeGreaterThan(50);
    expect(Math.abs(dominantFrequency(fromAdmin.samples) - ADMIN_TONE)).toBeLessThanOrEqual(10);
    expect(Math.abs(dominantFrequency(fromMember.samples) - MEMBER_TONE)).toBeLessThanOrEqual(10);

    // witness: huddle_mute_stops_transmitted_audio
    await adminPage.getByRole("button", { name: "Mute microphone" }).click();
    await expect(adminPage.getByRole("button", { name: "Unmute microphone" })).toBeVisible();
    const mutedFrom = Date.now() + 1_000;
    await adminPage.waitForTimeout(3_500);
    const muted = await native.decodeFrom(admin.pubkey, mutedFrom);
    if (muted.frames > 0) {
      expect(toneProminenceDb(muted.samples, ADMIN_TONE)).toBeLessThan(SILENT_DB);
      expect(rmsDbfs(muted.samples)).toBeLessThan(-45);
    }
    const mutedAtMember = await playedToneProminence(memberPage, [ADMIN_TONE], 2_000);
    expect(mutedAtMember[ADMIN_TONE]).toBeLessThan(SILENT_DB);
    await adminPage.getByRole("button", { name: "Unmute microphone" }).click();
    const unmutedFrom = Date.now() + 1_000;
    await adminPage.waitForTimeout(3_500);
    const unmuted = await native.decodeFrom(admin.pubkey, unmutedFrom);
    expect(Math.abs(dominantFrequency(unmuted.samples) - ADMIN_TONE)).toBeLessThanOrEqual(10);

    // witness: huddle_leave_releases_capture
    await adminPage.getByRole("button", { name: "Leave huddle" }).click();
    await expect.poll(() => native?.left.includes(admin.pubkey), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => liveCaptureTracks(adminPage), { timeout: 15_000 }).toBe(0);
    expect(await capturedTracks(adminPage)).toBeGreaterThan(0);
    const afterLeave = Date.now() + 1_000;
    await adminPage.waitForTimeout(2_500);
    expect((await native.decodeFrom(admin.pubkey, afterLeave)).frames).toBe(0);

    // witness: huddle_membership_revocation_stops_audio
    await removeMember(adminPage, memberName);
    await expect.poll(() => native?.left.includes(member.pubkey), { timeout: 20_000 }).toBe(true);
    await expect(memberPage.getByRole("button", { name: "Leave huddle" })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect.poll(() => liveCaptureTracks(memberPage), { timeout: 15_000 }).toBe(0);
    const afterRevocation = Date.now() + 1_000;
    await memberPage.waitForTimeout(2_500);
    expect((await native.decodeFrom(member.pubkey, afterRevocation)).frames).toBe(0);
    const revokedAtMember = await playedToneProminence(memberPage, [NATIVE_TONE], 2_000);
    expect(revokedAtMember[NATIVE_TONE]).toBeLessThan(SILENT_DB);

    native.close();
    await nativeStream;
  } finally {
    native?.close();
    if (channelCreated) await archiveChannel(adminPage, channelName).catch(() => undefined);
    await adminClient.browser.close();
    await memberClient.browser.close();
  }
});
