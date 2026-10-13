import {
  createCaptureNode,
  createPlayoutNode,
  loadAudioWorklets,
  startAudioContext,
} from "@/features/voice/lib/audio-worklets";
import { FRAME_SAMPLES } from "@/features/voice/lib/huddle-wire";
import { huddleAudioConstraints } from "@/features/voice/lib/microphone";

type SinkAudioContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };

async function captureStream(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: huddleAudioConstraints(deviceId) });
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/**
 * The browser side of one Huddle: microphone capture into 20 ms 48 kHz mono
 * frames, and a per-peer jitter-buffered playout mixed into the AudioContext
 * destination. Owns every capture track and the AudioContext; `close()`
 * releases all of them.
 */
export class HuddleAudioEngine {
  private stream: MediaStream | null;
  private source: MediaStreamAudioSourceNode | null = null;
  private readonly gain: GainNode;
  private closed = false;

  private constructor(
    private readonly context: SinkAudioContext,
    stream: MediaStream,
    private readonly capture: AudioWorkletNode,
    private readonly playout: AudioWorkletNode,
    private readonly onMicrophoneLost: () => void,
  ) {
    this.stream = stream;
    this.gain = context.createGain();
    playout.connect(this.gain);
    this.gain.connect(context.destination);
    this.attachSource(stream);
    // Autoplay policy may leave the context suspended until the next gesture.
    window.addEventListener("pointerdown", this.resume);
    window.addEventListener("keydown", this.resume);
  }

  private readonly resume = () => {
    if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
  };

  /** Acquire the microphone and build the audio graph; throws getUserMedia errors. */
  static async open(options: {
    inputDeviceId: string | null;
    onFrame: (frame: Float32Array) => void;
    onMicrophoneLost: () => void;
  }): Promise<HuddleAudioEngine> {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
      throw new DOMException("Audio capture is unavailable", "NotSupportedError");
    }
    const stream = await captureStream(options.inputDeviceId);
    let context: SinkAudioContext | null = null;
    try {
      context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
      try {
        context.createMediaStreamSource(stream).disconnect();
      } catch {
        // Firefox cannot mix a device rate into a 48 kHz context; capture at
        // the device rate and let the worklets resample.
        await context.close();
        context = new AudioContext({ latencyHint: "interactive" });
      }
      await loadAudioWorklets(context);
      await startAudioContext(context);
      const capture = createCaptureNode(context, { targetRate: 48_000, chunkSize: FRAME_SAMPLES });
      capture.port.onmessage = (event: MessageEvent<Float32Array>) => options.onFrame(event.data);
      const playout = createPlayoutNode(context);
      return new HuddleAudioEngine(context, stream, capture, playout, options.onMicrophoneLost);
    } catch (error) {
      stopStream(stream);
      if (context && context.state !== "closed") await context.close().catch(() => undefined);
      throw error;
    }
  }

  private attachSource(stream: MediaStream) {
    this.source = this.context.createMediaStreamSource(stream);
    this.source.connect(this.capture);
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (this.closed || this.stream !== stream) return;
        this.detachSource();
        this.onMicrophoneLost();
      });
    }
  }

  private detachSource() {
    this.source?.disconnect();
    this.source = null;
    stopStream(this.stream);
    this.stream = null;
  }

  get capturing(): boolean {
    return Boolean(this.stream?.getAudioTracks().some((track) => track.readyState === "live"));
  }

  /** The device id the browser actually opened (settles "default"). */
  get inputDeviceId(): string | null {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? null;
  }

  setMuted(muted: boolean) {
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted;
  }

  setDeafened(deafened: boolean) {
    this.gain.gain.value = deafened ? 0 : 1;
    if (deafened) this.playout.port.postMessage({ type: "clear" });
  }

  play(peer: number, samples: Float32Array) {
    if (this.closed) return;
    this.playout.port.postMessage({ type: "frame", peer, samples }, [samples.buffer]);
  }

  removePeer(peer: number) {
    this.playout.port.postMessage({ type: "remove", peer });
  }

  clearPeers() {
    this.playout.port.postMessage({ type: "clear" });
  }

  /** Switch (or reopen) the microphone; the old capture stops before the new one starts. */
  async replaceInput(deviceId: string | null): Promise<void> {
    this.detachSource();
    const stream = await captureStream(deviceId);
    if (this.closed) {
      stopStream(stream);
      return;
    }
    this.stream = stream;
    this.attachSource(stream);
  }

  async setOutput(deviceId: string | null): Promise<void> {
    await this.context.setSinkId?.(deviceId ?? "");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener("pointerdown", this.resume);
    window.removeEventListener("keydown", this.resume);
    this.capture.port.postMessage("stop");
    this.capture.port.onmessage = null;
    this.detachSource();
    this.capture.disconnect();
    this.playout.disconnect();
    this.gain.disconnect();
    if (this.context.state !== "closed") await this.context.close().catch(() => undefined);
  }
}
