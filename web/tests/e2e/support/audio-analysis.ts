import { spawn } from "node:child_process";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

/** Run ffmpeg with `input` on stdin and return stdout; non-zero exit is an error. */
export async function ffmpeg(args: string[], input?: Uint8Array): Promise<Buffer> {
  const child = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const exited = Promise.withResolvers<number | null>();
  child.on("close", (code) => exited.resolve(code));
  child.on("error", (error) => exited.reject(error));
  if (input) child.stdin.end(Buffer.from(input));
  else child.stdin.end();
  const code = await exited.promise;
  if (code !== 0) {
    throw new Error(`ffmpeg exited ${code}: ${Buffer.concat(stderr).toString().slice(0, 400)}`);
  }
  return Buffer.concat(stdout);
}

/**
 * Known synthetic "speech-like" input: a tone gated 300 ms on / 200 ms off so
 * browser noise suppression treats it as a non-stationary signal.
 */
export async function writeGatedToneWav(path: string, frequency: number, seconds = 30) {
  await ffmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`,
    "-af",
    "volume='if(lt(mod(t,0.5),0.3),0.6,0)':eval=frame",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    path,
  ]);
}

/** Decode any container ffmpeg understands into mono 48 kHz float samples. */
export async function decodeToMonoPcm(input: Uint8Array): Promise<Float32Array> {
  const raw = await ffmpeg(
    ["-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"],
    input,
  );
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

/** Goertzel power of `frequency` in `samples` (normalized by length). */
export function tonePower(samples: Float32Array, frequency: number, sampleRate = 48_000): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let previous = 0;
  let previous2 = 0;
  for (const sample of samples) {
    const current = sample + coefficient * previous - previous2;
    previous2 = previous;
    previous = current;
  }
  const power = previous2 * previous2 + previous * previous - coefficient * previous * previous2;
  return power / (samples.length * samples.length);
}

export function rmsDbfs(samples: Float32Array): number {
  if (!samples.length) return Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return 10 * Math.log10(sum / samples.length || 1e-20);
}

/** Strongest frequency in 100–2000 Hz, scanned in 5 Hz steps. */
export function dominantFrequency(samples: Float32Array, sampleRate = 48_000): number {
  const window = samples.subarray(0, Math.min(samples.length, sampleRate * 2));
  let best = 0;
  let bestPower = -1;
  for (let frequency = 100; frequency <= 2000; frequency += 5) {
    const power = tonePower(window, frequency, sampleRate);
    if (power > bestPower) {
      bestPower = power;
      best = frequency;
    }
  }
  return best;
}

/** Ratio (dB) of the tone's power to the mean power of reference off-tones. */
export function toneProminenceDb(samples: Float32Array, frequency: number): number {
  const references = [173, 251, 337, 529, 773, 1013, 1297].filter(
    (value) => Math.abs(value - frequency) > 40,
  );
  const target = tonePower(samples, frequency);
  const floor =
    references.reduce((total, value) => total + tonePower(samples, value), 0) / references.length;
  return 10 * Math.log10((target + 1e-20) / (floor + 1e-20));
}
