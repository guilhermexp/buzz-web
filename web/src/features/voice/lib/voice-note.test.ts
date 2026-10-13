import { describe, expect, it } from "vitest";
import {
  encodeVoiceNoteWav,
  formatVoiceNoteDuration,
  isVoiceNoteAttachment,
} from "@/features/voice/lib/voice-note";

describe("isVoiceNoteAttachment", () => {
  it("recognizes desktop and web voice notes but not ordinary audio or images", () => {
    expect(isVoiceNoteAttachment({ filename: "voice-note-1712.wav", m: "audio/wav" })).toBe(true);
    expect(isVoiceNoteAttachment({ filename: "Voice-Note-1.webm", m: "AUDIO/WEBM" })).toBe(true);
    expect(isVoiceNoteAttachment({ filename: "voice-note-1.mp4", m: "video/mp4" })).toBe(true);
    expect(isVoiceNoteAttachment({ filename: "song.wav", m: "audio/wav" })).toBe(false);
    expect(isVoiceNoteAttachment({ filename: "voice-note-1.png", m: "image/png" })).toBe(false);
    expect(isVoiceNoteAttachment({ m: "audio/wav" })).toBe(false);
  });
});

describe("encodeVoiceNoteWav", () => {
  it("writes a mono 16-bit PCM RIFF/WAVE file at the output rate", () => {
    const second = Float32Array.from({ length: 48_000 }, (_, index) =>
      Math.sin((2 * Math.PI * 440 * index) / 48_000),
    );
    const wav = encodeVoiceNoteWav([second], 48_000, 24_000);
    const view = new DataView(wav.buffer);
    const ascii = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
    expect(ascii(0)).toBe("RIFF");
    expect(ascii(8)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(24_000 * 2);
    expect(wav.length).toBe(44 + 24_000 * 2);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
  });

  it("downmixes channels and clips out-of-range samples instead of wrapping", () => {
    const wav = encodeVoiceNoteWav(
      [Float32Array.of(2, 0.5, -3), Float32Array.of(2, -0.5, -3)],
      24_000,
      24_000,
    );
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(-0x8000);
  });

  it("refuses to encode an empty recording", () => {
    expect(() => encodeVoiceNoteWav([new Float32Array()], 48_000)).toThrow();
    expect(() => encodeVoiceNoteWav([], 48_000)).toThrow();
  });
});

describe("formatVoiceNoteDuration", () => {
  it("formats minutes and seconds, clamping invalid values", () => {
    expect(formatVoiceNoteDuration(0)).toBe("0:00");
    expect(formatVoiceNoteDuration(65.9)).toBe("1:05");
    expect(formatVoiceNoteDuration(300)).toBe("5:00");
    expect(formatVoiceNoteDuration(Number.NaN)).toBe("0:00");
    expect(formatVoiceNoteDuration(-4)).toBe("0:00");
  });
});
