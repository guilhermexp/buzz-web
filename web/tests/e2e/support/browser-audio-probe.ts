import type { BrowserContext, Page } from "@playwright/test";

/**
 * Test-owned observation of a page's real audio path, installed before app code:
 * - every node connected to an AudioContext destination is also connected to an
 *   analyser, so measurements reflect what the page actually plays out;
 * - every getUserMedia track is recorded, so capture cleanup is observable.
 * The probe never feeds audio back into the application.
 */
export async function installAudioProbe(context: BrowserContext) {
  await context.addInitScript(() => {
    type Tap = { context: BaseAudioContext; analyser: AnalyserNode };
    const taps: Tap[] = [];
    const tracks: MediaStreamTrack[] = [];
    const connect = AudioNode.prototype.connect as (
      this: AudioNode,
      destination: AudioNode | AudioParam,
      output?: number,
      input?: number,
    ) => AudioNode | undefined;
    AudioNode.prototype.connect = function patchedConnect(
      this: AudioNode,
      destination: AudioNode | AudioParam,
      output?: number,
      input?: number,
    ) {
      const result = connect.call(this, destination, output, input);
      if (destination instanceof AudioDestinationNode) {
        let tap = taps.find((item) => item.context === this.context);
        if (!tap) {
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 16_384;
          analyser.smoothingTimeConstant = 0;
          tap = { context: this.context, analyser };
          taps.push(tap);
        }
        connect.call(this, tap.analyser);
      }
      return result;
    } as typeof AudioNode.prototype.connect;

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.getUserMedia) {
      const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
        const stream = await getUserMedia(constraints);
        tracks.push(...stream.getTracks());
        return stream;
      };
    }

    Object.defineProperty(window, "__buzzAudioProbe", {
      value: {
        liveCaptureTracks: () =>
          tracks.filter((track) => track.kind === "audio" && track.readyState === "live").length,
        capturedTracks: () => tracks.length,
        async spectrum(milliseconds: number) {
          const live = taps.filter((tap) => tap.context.state !== "closed");
          if (!live.length) return null;
          const sampleRate = live[0]?.context.sampleRate ?? 48_000;
          const bins = 8_192;
          const sum = new Float64Array(bins);
          const scratch = new Float32Array(bins);
          let snapshots = 0;
          const deadline = performance.now() + milliseconds;
          while (performance.now() < deadline) {
            for (const tap of live) {
              tap.analyser.getFloatFrequencyData(scratch);
              for (let index = 0; index < bins; index += 1) {
                sum[index] = (sum[index] ?? 0) + 10 ** ((scratch[index] ?? -200) / 10);
              }
            }
            snapshots += 1;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return {
            sampleRate,
            power: Array.from(sum, (value) => value / Math.max(1, snapshots)),
          };
        },
      },
    });
  });
}

type ProbeWindow = {
  __buzzAudioProbe?: {
    liveCaptureTracks(): number;
    capturedTracks(): number;
    spectrum(milliseconds: number): Promise<{ sampleRate: number; power: number[] } | null>;
  };
};

/** Live microphone tracks this page obtained and has not stopped. */
export function liveCaptureTracks(page: Page): Promise<number> {
  return page.evaluate(() => (window as ProbeWindow).__buzzAudioProbe?.liveCaptureTracks() ?? 0);
}

/** Microphone tracks this page has ever obtained. */
export function capturedTracks(page: Page): Promise<number> {
  return page.evaluate(() => (window as ProbeWindow).__buzzAudioProbe?.capturedTracks() ?? 0);
}

/**
 * Prominence (dB above the 100–2000 Hz median) of each frequency in the audio
 * the page played out during the window; -Infinity when nothing reached output.
 */
export async function playedToneProminence(
  page: Page,
  frequencies: number[],
  milliseconds = 3_000,
): Promise<Record<number, number>> {
  const measured = await page.evaluate(
    (duration) => (window as ProbeWindow).__buzzAudioProbe?.spectrum(duration) ?? null,
    milliseconds,
  );
  const result: Record<number, number> = {};
  if (!measured) {
    for (const frequency of frequencies) result[frequency] = Number.NEGATIVE_INFINITY;
    return result;
  }
  const binHz = measured.sampleRate / (measured.power.length * 2);
  const band = measured.power
    .slice(Math.floor(100 / binHz), Math.ceil(2000 / binHz))
    .sort((left, right) => left - right);
  const median = band[Math.floor(band.length / 2)] ?? 0;
  for (const frequency of frequencies) {
    const center = Math.round(frequency / binHz);
    let peak = 0;
    for (let index = center - 3; index <= center + 3; index += 1) {
      peak = Math.max(peak, measured.power[index] ?? 0);
    }
    result[frequency] =
      peak > 0 && median > 0 ? 10 * Math.log10(peak / median) : Number.NEGATIVE_INFINITY;
  }
  return result;
}
