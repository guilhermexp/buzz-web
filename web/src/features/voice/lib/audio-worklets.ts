// AudioWorklet processors for microphone capture and Huddle playout. They run
// on the audio rendering thread, so they are plain JavaScript loaded from a
// Blob URL: no bundler-specific worklet handling and identical in every
// browser that implements AudioWorklet.

export const CAPTURE_PROCESSOR = "buzz-pcm-capture";
export const PLAYOUT_PROCESSOR = "buzz-huddle-playout";

/** Processor module source; exported so tests can run it outside a browser. */
export const AUDIO_WORKLET_SOURCE = `
class BuzzPcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    this.targetRate = settings.targetRate || sampleRate;
    this.chunk = settings.chunkSize || 960;
    this.ratio = sampleRate / this.targetRate;
    this.position = 0;
    this.previous = 0;
    this.buffer = new Float32Array(this.chunk);
    this.filled = 0;
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.running = false;
    };
  }
  emit(sample) {
    this.buffer[this.filled++] = sample;
    if (this.filled === this.chunk) {
      const full = this.buffer;
      this.port.postMessage(full, [full.buffer]);
      this.buffer = new Float32Array(this.chunk);
      this.filled = 0;
    }
  }
  process(inputs) {
    if (!this.running) return false;
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const length = input[0].length;
    const channels = input.length;
    const mono = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const data = input[c];
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
    if (this.ratio === 1) {
      for (let i = 0; i < length; i++) this.emit(mono[i]);
      return true;
    }
    let p = this.position;
    while (p < length - 1) {
      const index = Math.floor(p);
      const left = index < 0 ? this.previous : mono[index];
      const right = mono[index + 1];
      this.emit(left + (right - left) * (p - index));
      p += this.ratio;
    }
    this.position = p - length;
    this.previous = mono[length - 1];
    return true;
  }
}
registerProcessor("${CAPTURE_PROCESSOR}", BuzzPcmCapture);

class BuzzHuddlePlayout extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    this.step = (settings.sourceRate || 48000) / sampleRate;
    this.targetFrames = settings.targetFrames || 3;
    this.maxFrames = settings.maxFrames || 12;
    this.peers = new Map();
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message.type === "frame") this.push(message.peer, message.samples);
      else if (message.type === "remove") this.peers.delete(message.peer);
      else if (message.type === "clear") this.peers.clear();
    };
  }
  push(id, samples) {
    let peer = this.peers.get(id);
    if (!peer) {
      peer = { queue: [], position: 0, buffering: true };
      this.peers.set(id, peer);
    }
    peer.queue.push(samples);
    if (peer.queue.length > this.maxFrames) {
      peer.queue.splice(0, peer.queue.length - this.targetFrames);
      peer.position = 0;
    }
  }
  process(_inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    for (const peer of this.peers.values()) {
      if (peer.buffering) {
        if (peer.queue.length < this.targetFrames) continue;
        peer.buffering = false;
      }
      for (let i = 0; i < output.length; i++) {
        const head = peer.queue[0];
        if (!head) {
          peer.buffering = true;
          break;
        }
        const index = Math.floor(peer.position);
        const left = head[index];
        const next = index + 1 < head.length ? head[index + 1] : peer.queue[1] ? peer.queue[1][0] : left;
        output[i] += left + (next - left) * (peer.position - index);
        peer.position += this.step;
        while (peer.queue.length && peer.position >= peer.queue[0].length) {
          peer.position -= peer.queue[0].length;
          peer.queue.shift();
        }
      }
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(output);
    return true;
  }
}
registerProcessor("${PLAYOUT_PROCESSOR}", BuzzHuddlePlayout);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Register Buzz's processors in `context` once. */
export function loadAudioWorklets(context: BaseAudioContext): Promise<void> {
  const existing = loaded.get(context);
  if (existing) return existing;
  const url = URL.createObjectURL(new Blob([AUDIO_WORKLET_SOURCE], { type: "text/javascript" }));
  const promise = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
  loaded.set(context, promise);
  return promise;
}

const AUDIO_START_TIMEOUT_MS = 5_000;

/**
 * Resume `context` (called from a user gesture). Where the browser has no
 * usable audio backend, `resume()` never settles; capture would then hold the
 * microphone open while processing nothing, so give up with NotSupportedError.
 */
export async function startAudioContext(
  context: AudioContext,
  timeoutMs = AUDIO_START_TIMEOUT_MS,
): Promise<void> {
  if (context.state === "running") return;
  let timer: number | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = window.setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([context.resume(), timedOut]);
  } finally {
    window.clearTimeout(timer);
  }
  // Re-read: resume() above changes the state the narrowed type does not track.
  if ((context.state as AudioContextState) !== "running") {
    throw new DOMException("Audio processing could not start", "NotSupportedError");
  }
}

/** A sink-only capture node that posts mono `chunkSize` blocks at `targetRate`. */
export function createCaptureNode(
  context: BaseAudioContext,
  options: { targetRate?: number; chunkSize: number },
): AudioWorkletNode {
  return new AudioWorkletNode(context, CAPTURE_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    processorOptions: {
      targetRate: options.targetRate ?? context.sampleRate,
      chunkSize: options.chunkSize,
    },
  });
}

export function createPlayoutNode(context: BaseAudioContext): AudioWorkletNode {
  return new AudioWorkletNode(context, PLAYOUT_PROCESSOR, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { sourceRate: 48_000, targetFrames: 3, maxFrames: 12 },
  });
}
