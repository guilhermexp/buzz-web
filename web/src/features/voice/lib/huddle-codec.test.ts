import { getPacketInfo } from "libopus-wasm";
import { describe, expect, it } from "vitest";
import {
  createFrameDecoder,
  createFrameEncoder,
  probeCodecSupport,
} from "@/features/voice/lib/huddle-codec";
import { FRAME_SAMPLES } from "@/features/voice/lib/huddle-wire";

function goertzel(samples: Float32Array, frequency: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / 48_000);
  let previous = 0;
  let previous2 = 0;
  for (const sample of samples) {
    const value = sample + coefficient * previous - previous2;
    previous2 = previous;
    previous = value;
  }
  return (previous2 ** 2 + previous ** 2 - coefficient * previous * previous2) / samples.length;
}

// Node has no WebCodecs, so this exercises the WebAssembly libopus fallback
// that browsers without AudioEncoder/AudioDecoder use.
describe("WASM Opus fallback", () => {
  it("is selected when WebCodecs is unavailable", async () => {
    expect(await probeCodecSupport()).toEqual({ encoder: "wasm", decoder: "wasm" });
  });

  it("produces standard 20 ms mono Opus packets that decode back to the same tone", async () => {
    const packets: Uint8Array[] = [];
    const errors: Error[] = [];
    const encoder = await createFrameEncoder(
      (packet) => packets.push(packet),
      (error) => errors.push(error),
    );
    const frames = 50;
    for (let frame = 0; frame < frames; frame += 1) {
      const pcm = Float32Array.from(
        { length: FRAME_SAMPLES },
        (_, index) =>
          0.5 * Math.sin((2 * Math.PI * 440 * (frame * FRAME_SAMPLES + index)) / 48_000),
      );
      encoder.encode(pcm, frame);
    }
    encoder.close();
    expect(errors).toEqual([]);
    expect(packets).toHaveLength(frames);
    const info = await getPacketInfo(packets[10] as Uint8Array);
    expect(info).toMatchObject({ channels: 1, durationMs: 20, samples: FRAME_SAMPLES });
    // VBR around 32 kbps: a 20 ms packet is roughly 80 bytes, far below the 4 KiB wire limit.
    const average = packets.reduce((sum, packet) => sum + packet.length, 0) / packets.length;
    expect(average).toBeGreaterThan(20);
    expect(average).toBeLessThan(200);

    const decoded: Float32Array[] = [];
    const decoder = await createFrameDecoder(
      (pcm) => decoded.push(pcm),
      (error) => errors.push(error),
    );
    for (const [index, packet] of packets.entries()) decoder.decode(packet, index);
    decoder.close();
    expect(errors).toEqual([]);
    expect(decoded).toHaveLength(frames);
    expect(decoded.every((pcm) => pcm.length === FRAME_SAMPLES)).toBe(true);
    const steady = Float32Array.from(decoded.slice(10).flatMap((pcm) => [...pcm]));
    expect(goertzel(steady, 440)).toBeGreaterThan(100 * goertzel(steady, 660));
  });
});
