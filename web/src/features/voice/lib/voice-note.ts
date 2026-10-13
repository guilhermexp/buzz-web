// Voice notes are mono 16-bit PCM WAV files named `voice-note-<ms>.wav`, the
// same shape Buzz Desktop records (desktop audioAttachment.ts / voiceNoteWav.ts),
// so either client recognizes and plays the other's notes.

export const VOICE_NOTE_MAX_DURATION_SECONDS = 5 * 60;
export const VOICE_NOTE_SAMPLE_RATE = 24_000;
export const VOICE_NOTE_MIME = "audio/wav";

/** Whether an imeta attachment is a voice note (mirrors desktop audioAttachment.ts). */
export function isVoiceNoteAttachment(entry: { filename?: string; m?: string }): boolean {
  const mime = entry.m?.toLowerCase() ?? "";
  const filename = entry.filename?.toLowerCase() ?? "";
  if (!filename.startsWith("voice-note-")) return false;
  if (mime.startsWith("audio/")) return true;
  return mime === "video/mp4" && filename.endsWith(".mp4");
}

export function voiceNoteFileName(now = Date.now()): string {
  return `voice-note-${now}.wav`;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

/**
 * Downmix and linearly resample captured channels into a mono 16-bit PCM WAV.
 * Throws on empty input: an empty recording must never become an attachment.
 */
export function encodeVoiceNoteWav(
  channels: readonly Float32Array[],
  inputSampleRate: number,
  outputSampleRate = VOICE_NOTE_SAMPLE_RATE,
): Uint8Array<ArrayBuffer> {
  const inputLength = channels[0]?.length ?? 0;
  if (
    channels.length === 0 ||
    inputLength === 0 ||
    !Number.isFinite(inputSampleRate) ||
    inputSampleRate <= 0 ||
    !Number.isFinite(outputSampleRate) ||
    outputSampleRate <= 0
  ) {
    throw new Error("Cannot encode an empty voice note");
  }

  const frameCount = Math.max(1, Math.floor((inputLength * outputSampleRate) / inputSampleRate));
  const bytes = new Uint8Array(44 + frameCount * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputSampleRate, true);
  view.setUint32(28, outputSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, frameCount * 2, true);

  const ratio = inputSampleRate / outputSampleRate;
  for (let outputIndex = 0; outputIndex < frameCount; outputIndex += 1) {
    const sourcePosition = outputIndex * ratio;
    const leftIndex = Math.min(inputLength - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(inputLength - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    let sample = 0;
    for (const channel of channels) {
      const left = channel[leftIndex] ?? 0;
      const right = channel[rightIndex] ?? left;
      sample += left + (right - left) * mix;
    }
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    view.setInt16(44 + outputIndex * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

/** Concatenate captured PCM chunks into one buffer. */
export function concatenatePcm(chunks: readonly Float32Array[]): Float32Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const joined = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/** Root-mean-square of a PCM block mapped to a 0..1 meter level (desktop scale). */
export function meterLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / samples.length) * 5.5);
}

/** `m:ss` for a recording timer or a note's duration. */
export function formatVoiceNoteDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
