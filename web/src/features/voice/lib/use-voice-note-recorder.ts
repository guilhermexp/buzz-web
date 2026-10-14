import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCaptureNode,
  loadAudioWorklets,
  startAudioContext,
} from "@/features/voice/lib/audio-worklets";
import { type MicrophoneErrorCode, microphoneErrorCode } from "@/features/voice/lib/microphone";
import {
  concatenatePcm,
  encodeVoiceNoteWav,
  meterLevel,
  VOICE_NOTE_MAX_DURATION_SECONDS,
  VOICE_NOTE_MIME,
  voiceNoteFileName,
} from "@/features/voice/lib/voice-note";

export type VoiceNoteRecording = { file: File; durationSeconds: number };
export type VoiceNoteRecorderStatus = "idle" | "requesting" | "recording" | "processing";
export type VoiceNoteRecorderError = MicrophoneErrorCode | "empty" | "interrupted";

const CHUNK_SIZE = 2048;
const LEVEL_HISTORY = 48;

type Session = {
  stream: MediaStream | null;
  context: AudioContext | null;
  node: AudioWorkletNode | null;
  chunks: Float32Array[];
  samples: number;
  sampleRate: number;
  cancelled: boolean;
  timer: number | null;
};

function release(session: Session) {
  if (session.timer !== null) window.clearTimeout(session.timer);
  session.timer = null;
  session.node?.port.postMessage("stop");
  session.node?.disconnect();
  session.node = null;
  for (const track of session.stream?.getTracks() ?? []) track.stop();
  session.stream = null;
  const context = session.context;
  session.context = null;
  if (context && context.state !== "closed") void context.close().catch(() => undefined);
}

/**
 * Records a voice note from the microphone as PCM through an AudioWorklet and
 * encodes it as a mono WAV on finish. Every exit path (discard, finish,
 * failure, unmount) stops all capture tracks and closes the AudioContext.
 */
export function useVoiceNoteRecorder(onRecorded: (recording: VoiceNoteRecording) => void) {
  const sessionRef = useRef<Session | null>(null);
  const mountedRef = useRef(true);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const [status, setStatus] = useState<VoiceNoteRecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<VoiceNoteRecorderError | null>(null);

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus("idle");
    setElapsedSeconds(0);
    setLevels([]);
  }, []);

  const discard = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    sessionRef.current = null;
    release(session);
    reset();
  }, [reset]);

  const finish = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.cancelled) return;
    sessionRef.current = null;
    const { chunks, sampleRate } = session;
    release(session);
    if (mountedRef.current) setStatus("processing");
    try {
      const pcm = concatenatePcm(chunks);
      const wav = encodeVoiceNoteWav([pcm], sampleRate);
      const file = new File([wav], voiceNoteFileName(), { type: VOICE_NOTE_MIME });
      reset();
      onRecordedRef.current({ file, durationSeconds: pcm.length / sampleRate });
    } catch {
      reset();
      if (mountedRef.current) setError("empty");
    }
  }, [reset]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
      setError(window.isSecureContext ? "unavailable" : "insecure");
      return;
    }
    const session: Session = {
      stream: null,
      context: null,
      node: null,
      chunks: [],
      samples: 0,
      sampleRate: 48_000,
      cancelled: false,
      timer: null,
    };
    sessionRef.current = session;
    setStatus("requesting");
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
      });
      if (session.cancelled || sessionRef.current !== session) {
        release(session);
        return;
      }
      const context = new AudioContext();
      session.context = context;
      session.sampleRate = context.sampleRate;
      await loadAudioWorklets(context);
      if (session.cancelled || sessionRef.current !== session) {
        release(session);
        return;
      }
      const node = createCaptureNode(context, { chunkSize: CHUNK_SIZE });
      session.node = node;
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (session.cancelled || sessionRef.current !== session) return;
        session.chunks.push(event.data);
        session.samples += event.data.length;
        const level = meterLevel(event.data);
        if (!mountedRef.current) return;
        setElapsedSeconds(session.samples / session.sampleRate);
        setLevels((previous) => [...previous.slice(1 - LEVEL_HISTORY), level]);
      };
      context.createMediaStreamSource(session.stream).connect(node);
      for (const track of session.stream.getAudioTracks()) {
        track.addEventListener("ended", () => {
          if (sessionRef.current !== session) return;
          if (mountedRef.current) setError("interrupted");
          finish();
        });
      }
      await startAudioContext(context);
      // Discarded, finished or ended while the context was starting: already released.
      if (session.cancelled || sessionRef.current !== session) return;
      session.timer = window.setTimeout(finish, VOICE_NOTE_MAX_DURATION_SECONDS * 1000);
      setStatus("recording");
    } catch (cause) {
      release(session);
      if (session.cancelled || sessionRef.current !== session) return;
      sessionRef.current = null;
      reset();
      if (mountedRef.current) setError(microphoneErrorCode(cause));
    }
  }, [finish, reset]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (!session) return;
      session.cancelled = true;
      sessionRef.current = null;
      release(session);
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { status, elapsedSeconds, levels, error, start, discard, finish, clearError };
}
