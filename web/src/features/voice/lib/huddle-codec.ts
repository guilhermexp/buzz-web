import { FRAME_SAMPLES } from "@/features/voice/lib/huddle-wire";

// libopus-wasm is imported dynamically below on purpose: its ~380 KB inline
// WebAssembly is needed only by browsers without WebCodecs Opus, so it stays
// in its own lazily loaded chunk instead of every client's bundle.

// Opus at 48 kHz mono, 20 ms frames, ~32 kbps VBR, voip, DTX — desktop parity.
// WebCodecs (AudioEncoder/AudioDecoder) is preferred; browsers without it use
// libopus compiled to WebAssembly (libopus-wasm), loaded only on demand. Both
// emit and accept standard raw Opus packets, so either side interoperates
// with desktop and native peers (libopus).

export type CodecBackend = "webcodecs" | "wasm";

export type FrameEncoder = {
  readonly backend: CodecBackend;
  /** Encode one 960-sample frame; `onPacket` receives it with the same `index`. */
  encode(frame: Float32Array, index: number): void;
  close(): void;
};

export type FrameDecoder = {
  readonly backend: CodecBackend;
  /** Decode one packet; `onPcm` receives 960 mono samples at 48 kHz. */
  decode(packet: Uint8Array, index: number): void;
  close(): void;
};

const SAMPLE_RATE = 48_000;
const BITRATE = 32_000;
const FRAME_MICROSECONDS = 20_000;

const ENCODER_CONFIGS: AudioEncoderConfig[] = [
  {
    codec: "opus",
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: BITRATE,
    bitrateMode: "variable",
    opus: { application: "voip", frameDuration: FRAME_MICROSECONDS, usedtx: true, format: "opus" },
  } as AudioEncoderConfig,
  {
    codec: "opus",
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: BITRATE,
    opus: { frameDuration: FRAME_MICROSECONDS, format: "opus" },
  },
];
const DECODER_CONFIG: AudioDecoderConfig = {
  codec: "opus",
  sampleRate: SAMPLE_RATE,
  numberOfChannels: 1,
};

async function supportedEncoderConfig(): Promise<AudioEncoderConfig | null> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
  for (const config of ENCODER_CONFIGS) {
    try {
      const support = await AudioEncoder.isConfigSupported(config);
      if (support.supported) return support.config ?? config;
    } catch {
      // Try the next, smaller configuration.
    }
  }
  return null;
}

async function webCodecsDecoderSupported(): Promise<boolean> {
  if (typeof AudioDecoder === "undefined" || typeof EncodedAudioChunk === "undefined") return false;
  try {
    return Boolean((await AudioDecoder.isConfigSupported(DECODER_CONFIG)).supported);
  } catch {
    return false;
  }
}

/** Which backend each direction will use in this browser. */
export async function probeCodecSupport(): Promise<{
  encoder: CodecBackend;
  decoder: CodecBackend;
}> {
  const [encoderConfig, decoder] = await Promise.all([
    supportedEncoderConfig(),
    webCodecsDecoderSupported(),
  ]);
  return { encoder: encoderConfig ? "webcodecs" : "wasm", decoder: decoder ? "webcodecs" : "wasm" };
}

function copyMono(data: AudioData): Float32Array {
  const options: AudioDataCopyToOptions = { planeIndex: 0, format: "f32-planar" };
  const samples = new Float32Array(data.allocationSize(options) / 4);
  data.copyTo(samples, options);
  return samples;
}

export async function createFrameEncoder(
  onPacket: (packet: Uint8Array, index: number) => void,
  onError: (error: Error) => void,
): Promise<FrameEncoder> {
  const config = await supportedEncoderConfig();
  if (config) {
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const packet = new Uint8Array(chunk.byteLength);
        chunk.copyTo(packet);
        onPacket(packet, Math.round(chunk.timestamp / FRAME_MICROSECONDS));
      },
      error: (error) => onError(error instanceof Error ? error : new Error(String(error))),
    });
    encoder.configure(config);
    return {
      backend: "webcodecs",
      encode(frame, index) {
        if (encoder.state !== "configured") return;
        const data = new AudioData({
          format: "f32-planar",
          sampleRate: SAMPLE_RATE,
          numberOfFrames: frame.length,
          numberOfChannels: 1,
          timestamp: index * FRAME_MICROSECONDS,
          // Capture frames arrive as transferred (non-shared) ArrayBuffers from the worklet.
          data: frame as Float32Array<ArrayBuffer>,
        });
        encoder.encode(data);
        data.close();
      },
      close() {
        if (encoder.state !== "closed") encoder.close();
      },
    };
  }
  const { createEncoder, Application } = await import("libopus-wasm");
  const encoder = await createEncoder({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    application: Application.Voip,
    bitrate: BITRATE,
    dtx: true,
    frameSize: FRAME_SAMPLES,
  });
  let closed = false;
  return {
    backend: "wasm",
    encode(frame, index) {
      if (closed) return;
      try {
        onPacket(encoder.encodeFloat(frame), index);
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    close() {
      if (closed) return;
      closed = true;
      encoder.free();
    },
  };
}

export async function createFrameDecoder(
  onPcm: (samples: Float32Array) => void,
  onError: (error: Error) => void,
): Promise<FrameDecoder> {
  if (await webCodecsDecoderSupported()) {
    const decoder = new AudioDecoder({
      output: (data) => {
        try {
          onPcm(copyMono(data));
        } finally {
          data.close();
        }
      },
      error: (error) => onError(error instanceof Error ? error : new Error(String(error))),
    });
    decoder.configure(DECODER_CONFIG);
    return {
      backend: "webcodecs",
      decode(packet, index) {
        if (decoder.state !== "configured") return;
        decoder.decode(
          new EncodedAudioChunk({
            type: "key",
            timestamp: index * FRAME_MICROSECONDS,
            data: packet,
          }),
        );
      },
      close() {
        if (decoder.state !== "closed") decoder.close();
      },
    };
  }
  const { createDecoder } = await import("libopus-wasm");
  const decoder = await createDecoder({ sampleRate: SAMPLE_RATE, channels: 1 });
  let closed = false;
  return {
    backend: "wasm",
    decode(packet) {
      if (closed) return;
      try {
        onPcm(decoder.decodeFloat(packet));
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    close() {
      if (closed) return;
      closed = true;
      decoder.free();
    },
  };
}
