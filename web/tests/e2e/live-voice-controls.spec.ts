import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  firefox,
  type Page,
  test,
} from "@playwright/test";
import { generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { dominantFrequency, rmsDbfs, writeGatedToneWav } from "./support/audio-analysis";
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
} from "./support/live-session";
import { NativeHuddlePeer } from "./support/native-huddle-peer";
import { NodeRelayClient } from "./support/node-relay";

// Live acceptance for Huddle recovery paths and a second browser engine.
// Audio input is SYNTHETIC (Chromium fake capture file / Firefox fake device);
// "device removal" is simulated by ending the capture track the way an
// unplugged device does (stop + `ended` event). Nothing here exercises a
// physical microphone, speaker, or human listening.

const ADMIN_TONE = 440;
const NATIVE_TONE = 880;
const AUDIBLE_DB = 20;
const SILENT_DB = 10;
const admin = identityFromEnvironment("BUZZ_LIVE_ADMIN_NSEC");

type Client = { browser: Browser; context: BrowserContext; page: Page };

function runIdentifier() {
  return `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

async function trackStreams(context: BrowserContext) {
  await context.addInitScript(() => {
    const streams: MediaStream[] = [];
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) return;
    const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await getUserMedia(constraints);
      streams.push(stream);
      return stream;
    };
    Object.defineProperty(window, "__voiceTestStreams", { value: streams });
  });
}

/** What an unplugged device does to a live capture track: it ends and fires `ended`. */
function unplugMicrophone(page: Page) {
  return page.evaluate(() => {
    const recorded: unknown = Reflect.get(window, "__voiceTestStreams");
    const streams = Array.isArray(recorded)
      ? recorded.filter((item): item is MediaStream => item instanceof MediaStream)
      : [];
    for (const track of streams.flatMap((stream) => stream.getAudioTracks())) {
      if (track.readyState !== "live") continue;
      track.stop();
      track.dispatchEvent(new Event("ended"));
    }
  });
}

async function launchChromium(
  baseURL: string,
  args: string[],
  permissions: string[],
): Promise<Client> {
  const browser = await chromium.launch({ env: browserEnvironment(), args });
  const context = await browser.newContext({ baseURL, locale: "en-US", permissions });
  await installAudioProbe(context);
  await trackStreams(context);
  return { browser, context, page: await context.newPage() };
}

async function startedHuddle(relayUrl: string, readerKey: Uint8Array, since: number) {
  const reader = await NodeRelayClient.connect(relayUrl, readerKey);
  try {
    const [started] = await reader.waitFor(
      [{ kinds: [48100], authors: [admin.pubkey], since }],
      (events) => events.length > 0,
    );
    const content: unknown = JSON.parse(String(started?.content));
    const ephemeral =
      content && typeof content === "object" && "ephemeral_channel_id" in content
        ? content.ephemeral_channel_id
        : undefined;
    const parent = started?.tags.find((tag) => tag[0] === "h")?.[1];
    if (!parent || typeof ephemeral !== "string") throw new Error("48100 without huddle ids");
    return { parentChannelId: parent, ephemeralChannelId: ephemeral };
  } finally {
    reader.close();
  }
}

async function recordEvidence(name: string, data: unknown) {
  const path = test.info().outputPath(`${name}.json`);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`evidence ${name}: ${JSON.stringify(data)}`);
}

test("denied microphone permission creates no room, captures nothing and explains recovery", async () => {
  const baseURL = String(test.info().project.use.baseURL);
  const relayUrl = liveRelayUrl();
  const channelName = `web-voice-denied-${runIdentifier()}`;
  const since = Math.floor(Date.now() / 1000) - 5;
  const client = await launchChromium(
    baseURL,
    // A real "Block" answer: headless Chromium cannot show a prompt and reports
    // NotSupportedError for one, while the fake UI in deny mode yields NotAllowedError.
    ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream=deny"],
    [],
  );
  const page = client.page;
  let created = false;
  try {
    await importIdentity(page, admin);
    await createPrivateChannel(page, channelName);
    created = true;

    await page.getByRole("button", { name: "Start huddle" }).click();
    await expect(page.getByText(/Microphone access is blocked/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Leave huddle" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start huddle" })).toBeEnabled();
    expect(await liveCaptureTracks(page)).toBe(0);

    await page.getByRole("button", { name: "Record voice note" }).click();
    await expect(page.getByText(/Microphone access is blocked/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Discard voice note" })).toHaveCount(0);
    expect(await liveCaptureTracks(page)).toBe(0);

    // No orphan room: neither the ephemeral channel nor a 48100 was published.
    await page.waitForTimeout(2_000);
    const reader = await NodeRelayClient.connect(relayUrl, admin.secretKey);
    let events: NostrEvent[] = [];
    try {
      events = await reader.query([{ kinds: [9007, 48100], authors: [admin.pubkey], since }]);
    } finally {
      reader.close();
    }
    const huddleEvents = events.filter(
      (event) =>
        event.kind === 48100 ||
        event.tags.some((tag) => tag[0] === "name" && tag[1]?.startsWith("huddle-")),
    );
    expect(huddleEvents).toHaveLength(0);
    await recordEvidence("denied-permission", {
      source: "Chromium --use-fake-ui-for-media-stream=deny (synthetic)",
      liveCaptureTracks: 0,
      huddleEventsPublished: huddleEvents.length,
    });
  } finally {
    if (created) await archiveChannel(page, channelName).catch(() => undefined);
    await client.browser.close();
  }
});

test("mute, removed device, deafen and reconnect keep audio and capture consistent", async () => {
  const testInfo = test.info();
  const baseURL = String(testInfo.project.use.baseURL);
  const relayUrl = liveRelayUrl();
  const channelName = `web-voice-recovery-${runIdentifier()}`;
  const since = Math.floor(Date.now() / 1000) - 5;
  const nativeKey = generateSecretKey();
  const tone = testInfo.outputPath("admin-tone.wav");
  await writeGatedToneWav(tone, ADMIN_TONE);
  const client = await launchChromium(
    baseURL,
    [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${tone}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
    ["microphone"],
  );
  const page = client.page;
  // Proxy the huddle socket through this Node process so the test can cut the
  // network: Playwright's connectToServer() cannot close the relay side
  // (1.62: the relay connection survives route.close()/server.close()).
  const relaySockets: WebSocket[] = [];
  let outage = false;
  await page.routeWebSocket(/\/huddle\/[^/]+\/audio$/, (route) => {
    if (outage) {
      void route.close({ code: 1011, reason: "simulated outage" });
      return;
    }
    const relay = new WebSocket(route.url());
    relay.binaryType = "arraybuffer";
    const pending: (string | Uint8Array<ArrayBuffer>)[] = [];
    relay.addEventListener("open", () => {
      for (const message of pending.splice(0)) relay.send(message);
    });
    relay.addEventListener("message", (event) => {
      route.send(typeof event.data === "string" ? event.data : Buffer.from(event.data));
    });
    relay.addEventListener("close", (event) => {
      route
        .close({ code: event.code === 1000 ? 1000 : 1011, reason: event.reason })
        .catch(() => undefined);
    });
    route.onMessage((message) => {
      const outgoing = typeof message === "string" ? message : new Uint8Array(message);
      if (relay.readyState === WebSocket.OPEN) relay.send(outgoing);
      else pending.push(outgoing);
    });
    route.onClose(() => relay.close());
    relaySockets.push(relay);
  });
  let created = false;
  let native: NativeHuddlePeer | undefined;
  try {
    await importIdentity(page, admin);
    await createPrivateChannel(page, channelName);
    created = true;
    await addMember(page, getPublicKey(nativeKey));
    await page.getByRole("button", { name: "Start huddle" }).click();
    await expect(page.getByRole("button", { name: "Leave huddle" })).toBeVisible({
      timeout: 30_000,
    });
    const ids = await startedHuddle(relayUrl, nativeKey, since);
    native = await NativeHuddlePeer.join({ relayUrl, secretKey: nativeKey, ...ids });
    // support NativeHuddlePeer.close() stops the tone without settling streamTone's
    // promise, so it is never awaited; an encode failure is an unhandled rejection.
    void native.streamTone(NATIVE_TONE, 120);
    const participants = page
      .getByRole("list", { name: "Huddle participants" })
      .getByRole("listitem");
    await expect(participants).toHaveCount(2, { timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const baselineFrom = Date.now();
    await page.waitForTimeout(2_500);
    const baseline = await native.decodeFrom(admin.pubkey, baselineFrom);
    expect(baseline.frames).toBeGreaterThan(50);
    expect(Math.abs(dominantFrequency(baseline.samples) - ADMIN_TONE)).toBeLessThanOrEqual(10);
    const capturesBefore = await capturedTracks(page);

    // Deafen: incoming audio stops reaching the output; undeafen restores it.
    await page.getByRole("button", { name: "Mute incoming audio" }).click();
    await page.waitForTimeout(500);
    const deafened = await playedToneProminence(page, [NATIVE_TONE], 2_000);
    expect(deafened[NATIVE_TONE]).toBeLessThan(SILENT_DB);
    await page.getByRole("button", { name: "Unmute incoming audio" }).click();
    await page.waitForTimeout(1_000);
    const undeafened = await playedToneProminence(page, [NATIVE_TONE], 2_000);
    expect(undeafened[NATIVE_TONE]).toBeGreaterThan(AUDIBLE_DB);

    // Removed device: capture ends, the UI says so, nothing is sent, recovery works.
    await unplugMicrophone(page);
    await expect(page.getByRole("button", { name: "Microphone unavailable" })).toBeDisabled();
    await expect(page.getByRole("alert")).toContainText("Your microphone was disconnected");
    expect(await liveCaptureTracks(page)).toBe(0);
    const lostFrom = Date.now() + 500;
    await page.waitForTimeout(2_500);
    const whileLost = await native.decodeFrom(admin.pubkey, lostFrom);
    expect(whileLost.frames).toBe(0);
    await page.getByRole("button", { name: "Retry microphone" }).click();
    await expect(page.getByRole("button", { name: "Mute microphone" })).toBeEnabled();
    await expect.poll(() => liveCaptureTracks(page)).toBe(1);
    expect(await capturedTracks(page)).toBe(capturesBefore + 1);
    // Nothing is sent while the device is lost (asserted above), so every frame in
    // a trailing 2 s window comes from the reopened capture. Wait for that window
    // to carry the tone instead of sampling one fixed window: a freshly opened
    // capture's audio processing can start late on a loaded host. The latency is
    // recorded so a slow recovery stays visible.
    const retriedAt = Date.now();
    const peer = native;
    let restored = await peer.decodeFrom(admin.pubkey, retriedAt);
    await expect
      .poll(
        async () => {
          restored = await peer.decodeFrom(admin.pubkey, Date.now() - 2_000);
          return (
            restored.frames > 50 && Math.abs(dominantFrequency(restored.samples) - ADMIN_TONE) <= 10
          );
        },
        { timeout: 15_000, intervals: [250] },
      )
      .toBe(true);
    const restoredAfterMs = Date.now() - retriedAt;

    // Reconnect: the network drops for ~3 s; the same capture resumes on a new socket.
    const capturesBeforeDrop = await capturedTracks(page);
    outage = true;
    // The relay sees the peer go away; the page sees an abnormal close.
    relaySockets.at(-1)?.close();
    await expect(page.getByText("Reconnecting…")).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => native?.left.includes(admin.pubkey), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(3_000);
    outage = false;
    await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(participants).toHaveCount(2, { timeout: 15_000 });
    expect(await liveCaptureTracks(page)).toBe(1);
    expect(await capturedTracks(page)).toBe(capturesBeforeDrop);
    const reconnectedFrom = Date.now() + 500;
    await page.waitForTimeout(2_500);
    const reconnected = await native.decodeFrom(admin.pubkey, reconnectedFrom);
    expect(reconnected.frames).toBeGreaterThan(50);
    expect(Math.abs(dominantFrequency(reconnected.samples) - ADMIN_TONE)).toBeLessThanOrEqual(10);
    const heardAfterReconnect = await playedToneProminence(page, [NATIVE_TONE], 2_000);
    expect(heardAfterReconnect[NATIVE_TONE]).toBeGreaterThan(AUDIBLE_DB);

    await page.getByRole("button", { name: "Leave huddle" }).click();
    await expect.poll(() => liveCaptureTracks(page), { timeout: 15_000 }).toBe(0);
    await recordEvidence("recovery", {
      source: "Chromium fake capture file (synthetic gated 440 Hz); native peer libopus 880 Hz",
      baselineFrames: baseline.frames,
      deafenedProminenceDb: deafened[NATIVE_TONE],
      undeafenedProminenceDb: undeafened[NATIVE_TONE],
      framesWhileDeviceLost: whileLost.frames,
      framesAfterRetry: restored.frames,
      restoredAfterMs,
      socketsOpened: relaySockets.length,
      framesAfterReconnect: reconnected.frames,
      captureTracksOpened: await capturedTracks(page),
    });
    native.close();
  } finally {
    native?.close();
    if (created) await archiveChannel(page, channelName).catch(() => undefined);
    await client.browser.close();
  }
});

test("Firefox captures, encodes, sends and plays huddle audio through the Relay", async () => {
  const baseURL = String(test.info().project.use.baseURL);
  const relayUrl = liveRelayUrl();
  const channelName = `web-voice-firefox-${runIdentifier()}`;
  const since = Math.floor(Date.now() / 1000) - 5;
  const nativeKey = generateSecretKey();
  const browser = await firefox.launch({
    env: browserEnvironment(),
    firefoxUserPrefs: {
      "media.navigator.streams.fake": true,
      "media.navigator.permission.disabled": true,
      "media.autoplay.default": 0,
      "media.autoplay.block-webaudio": false,
    },
  });
  const context = await browser.newContext({ baseURL, locale: "en-US" });
  await installAudioProbe(context);
  const page = await context.newPage();
  let created = false;
  let native: NativeHuddlePeer | undefined;
  try {
    await importIdentity(page, admin);
    const codecs = await page.evaluate(async () => {
      const encoder =
        typeof AudioEncoder === "undefined"
          ? false
          : Boolean(
              (
                await AudioEncoder.isConfigSupported({
                  codec: "opus",
                  sampleRate: 48_000,
                  numberOfChannels: 1,
                  bitrate: 32_000,
                })
              ).supported,
            );
      const decoder =
        typeof AudioDecoder === "undefined"
          ? false
          : Boolean(
              (
                await AudioDecoder.isConfigSupported({
                  codec: "opus",
                  sampleRate: 48_000,
                  numberOfChannels: 1,
                })
              ).supported,
            );
      return {
        userAgent: navigator.userAgent,
        webCodecsEncoder: encoder,
        webCodecsDecoder: decoder,
      };
    });
    await recordEvidence("firefox-codecs", codecs);
    // Capture and playout run in Web Audio; a Firefox without a usable audio
    // backend never starts an AudioContext, so this run could not prove anything.
    const webAudioRuns = await page.evaluate(async () => {
      const context = new AudioContext();
      const running = await Promise.race([
        context.resume().then(() => context.state === "running"),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
      ]);
      void context.close();
      return running;
    });
    if (!webAudioRuns) {
      throw new Error("Firefox Web Audio cannot start in this environment (no audio backend).");
    }
    await createPrivateChannel(page, channelName);
    created = true;
    await addMember(page, getPublicKey(nativeKey));

    // Voice note: record, finish, preview; capture is released.
    await page.getByRole("button", { name: "Record voice note" }).click();
    await expect(page.getByRole("button", { name: "Finish voice note" })).toBeEnabled();
    await page.waitForTimeout(2_000);
    await page.getByRole("button", { name: "Finish voice note" }).click();
    await expect(page.getByRole("button", { name: "Remove voice note" })).toBeVisible();
    await expect.poll(() => liveCaptureTracks(page)).toBe(0);
    await page.getByRole("button", { name: "Remove voice note" }).click();

    await page.getByRole("button", { name: "Start huddle" }).click();
    await expect(page.getByRole("button", { name: "Leave huddle" })).toBeVisible({
      timeout: 30_000,
    });
    const ids = await startedHuddle(relayUrl, nativeKey, since);
    native = await NativeHuddlePeer.join({ relayUrl, secretKey: nativeKey, ...ids });
    void native.streamTone(NATIVE_TONE, 40);
    await expect(
      page.getByRole("list", { name: "Huddle participants" }).getByRole("listitem"),
    ).toHaveCount(2, { timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const from = Date.now();
    const heard = await playedToneProminence(page, [NATIVE_TONE], 3_000);
    const sent = await native.decodeFrom(admin.pubkey, from);
    expect(heard[NATIVE_TONE]).toBeGreaterThan(AUDIBLE_DB);
    expect(sent.frames).toBeGreaterThan(50);
    // Firefox's fake device is a fixed tone; it must arrive as a real, non-silent signal.
    expect(rmsDbfs(sent.samples)).toBeGreaterThan(-45);
    await page.getByRole("button", { name: "Leave huddle" }).click();
    await expect.poll(() => native?.left.includes(admin.pubkey), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => liveCaptureTracks(page), { timeout: 15_000 }).toBe(0);
    await recordEvidence("firefox", {
      source: "Firefox media.navigator.streams.fake (synthetic tone); native peer libopus 880 Hz",
      ...codecs,
      playedNativeProminenceDb: heard[NATIVE_TONE],
      framesFromFirefox: sent.frames,
      firefoxSignalDominantHz: dominantFrequency(sent.samples),
      firefoxSignalRmsDbfs: rmsDbfs(sent.samples),
    });
    native.close();
  } finally {
    native?.close();
    if (created) await archiveChannel(page, channelName).catch(() => undefined);
    await browser.close();
  }
});
