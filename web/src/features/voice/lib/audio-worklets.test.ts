import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_WORKLET_SOURCE,
  CAPTURE_PROCESSOR,
  PLAYOUT_PROCESSOR,
  startAudioContext,
} from "@/features/voice/lib/audio-worklets";

type Port = { onmessage: ((event: { data: unknown }) => void) | null; posted: unknown[] };
type Processor = {
  port: Port;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
type ProcessorClass = new (options: { processorOptions: Record<string, number> }) => Processor;

/** Evaluate the real worklet module with the AudioWorkletGlobalScope it expects. */
function loadProcessors(sampleRate: number): Record<string, ProcessorClass> {
  const registered: Record<string, ProcessorClass> = {};
  class AudioWorkletProcessor {
    port: Port = {
      onmessage: null,
      posted: [],
      postMessage(this: Port, message: unknown) {
        this.posted.push(message);
      },
    } as Port & { postMessage(message: unknown): void };
  }
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", AUDIO_WORKLET_SOURCE)(
    AudioWorkletProcessor,
    (name: string, processor: ProcessorClass) => {
      registered[name] = processor;
    },
    sampleRate,
  );
  return registered;
}

function tone(length: number, frequency: number, rate: number, offset = 0) {
  return Float32Array.from({ length }, (_, index) =>
    Math.sin((2 * Math.PI * frequency * (index + offset)) / rate),
  );
}

function render(processor: Processor, quanta: number): Float32Array {
  const out = new Float32Array(quanta * 128);
  for (let quantum = 0; quantum < quanta; quantum += 1) {
    const output = new Float32Array(128);
    processor.process([], [[output]]);
    out.set(output, quantum * 128);
  }
  return out;
}

describe("capture processor", () => {
  it("posts exact 960-sample frames at 48 kHz from a 44.1 kHz device", () => {
    const Capture = loadProcessors(44_100)[CAPTURE_PROCESSOR] as ProcessorClass;
    const capture = new Capture({ processorOptions: { targetRate: 48_000, chunkSize: 960 } });
    const seconds = 1;
    for (let offset = 0; offset < 44_100 * seconds; offset += 128) {
      capture.process([[tone(128, 440, 44_100, offset)]], []);
    }
    const frames = capture.port.posted as Float32Array[];
    expect(frames.every((frame) => frame.length === 960)).toBe(true);
    // One second at 44.1 kHz is 48 000 output samples, i.e. 50 frames (±1 at the edge).
    expect(Math.abs(frames.length - 50)).toBeLessThanOrEqual(1);
    // Resampling keeps the tone: zero crossings ≈ 2·440 per second.
    const joined = Float32Array.from(frames.flatMap((frame) => [...frame]));
    let crossings = 0;
    for (let index = 1; index < joined.length; index += 1) {
      if ((joined[index - 1] ?? 0) < 0 !== (joined[index] ?? 0) < 0) crossings += 1;
    }
    expect(Math.abs(crossings / (joined.length / 48_000) - 880)).toBeLessThan(10);
  });

  it("stops processing after the stop message", () => {
    const Capture = loadProcessors(48_000)[CAPTURE_PROCESSOR] as ProcessorClass;
    const capture = new Capture({ processorOptions: { chunkSize: 960 } });
    capture.port.onmessage?.({ data: "stop" });
    expect(capture.process([[new Float32Array(128)]], [])).toBe(false);
  });
});

describe("playout processor", () => {
  function playout() {
    const Playout = loadProcessors(48_000)[PLAYOUT_PROCESSOR] as ProcessorClass;
    const processor = new Playout({
      processorOptions: { sourceRate: 48_000, targetFrames: 3, maxFrames: 12 },
    });
    const push = (peer: number, samples: Float32Array) =>
      processor.port.onmessage?.({ data: { type: "frame", peer, samples } });
    return { processor, push };
  }

  it("holds playback until the jitter target is buffered, then plays in order", () => {
    const { processor, push } = playout();
    push(1, new Float32Array(960).fill(0.1));
    push(1, new Float32Array(960).fill(0.2));
    expect(render(processor, 4).every((sample) => sample === 0)).toBe(true);
    push(1, new Float32Array(960).fill(0.3));
    const out = render(processor, 23);
    expect(out[0]).toBeCloseTo(0.1);
    expect(out[1_000]).toBeCloseTo(0.2);
    expect(out[2_000]).toBeCloseTo(0.3);
    // Underrun: silence, then re-buffer instead of stuttering single frames.
    expect(out[2_900]).toBe(0);
    push(1, new Float32Array(960).fill(0.5));
    expect(render(processor, 8).every((sample) => sample === 0)).toBe(true);
  });

  it("mixes peers and removes a departed peer immediately", () => {
    const { processor, push } = playout();
    for (let frame = 0; frame < 3; frame += 1) {
      push(1, new Float32Array(960).fill(0.25));
      push(2, new Float32Array(960).fill(0.5));
    }
    expect(render(processor, 1)[0]).toBeCloseTo(0.75);
    processor.port.onmessage?.({ data: { type: "remove", peer: 2 } });
    expect(render(processor, 1)[0]).toBeCloseTo(0.25);
    processor.port.onmessage?.({ data: { type: "clear" } });
    expect(render(processor, 1).every((sample) => sample === 0)).toBe(true);
  });

  it("bounds latency by dropping the oldest audio when a burst overflows the buffer", () => {
    const { processor, push } = playout();
    for (let frame = 0; frame < 13; frame += 1) push(1, new Float32Array(960).fill(frame / 100));
    // 13 > max 12: the queue is cut back to the newest 3 frames (10, 11, 12).
    const out = render(processor, 30);
    expect(out[0]).toBeCloseTo(0.1);
    expect(out[960 * 2 + 10]).toBeCloseTo(0.12);
    expect(out[960 * 3 + 10]).toBe(0);
  });
});

describe("startAudioContext", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gives up when the browser can never start audio, instead of holding the microphone forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const stuck = { state: "suspended", resume: () => new Promise<void>(() => undefined) };
    const started = startAudioContext(stuck as unknown as AudioContext, 5_000);
    const outcome = expect(started).rejects.toMatchObject({ name: "NotSupportedError" });
    await vi.advanceTimersByTimeAsync(5_000);
    await outcome;
  });

  it("resolves once a suspended context resumes", async () => {
    vi.stubGlobal("window", globalThis);
    const context = {
      state: "suspended",
      resume() {
        this.state = "running";
        return Promise.resolve();
      },
    };
    await expect(startAudioContext(context as unknown as AudioContext)).resolves.toBeUndefined();
  });
});
