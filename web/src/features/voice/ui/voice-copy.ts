import type { HuddleErrorCode } from "@/features/voice/lib/huddle-types";
import type { VoiceNoteRecorderError } from "@/features/voice/lib/use-voice-note-recorder";
import { type MessageKey, t } from "@/shared/i18n";

const ERROR_KEYS: Record<VoiceNoteRecorderError | HuddleErrorCode, MessageKey> = {
  denied: "voice.error.denied",
  notFound: "voice.error.notFound",
  busy: "voice.error.busy",
  insecure: "voice.error.insecure",
  unavailable: "voice.error.unavailable",
  empty: "voice.error.empty",
  interrupted: "voice.error.interrupted",
  deviceLost: "voice.error.deviceLost",
  revoked: "voice.error.revoked",
  ended: "voice.error.ended",
  full: "voice.error.full",
  unsupported: "voice.error.unsupported",
  notMember: "voice.error.notMember",
  auth: "voice.error.auth",
  codec: "voice.error.codec",
  connection: "voice.error.connection",
  start: "voice.error.start",
  join: "voice.error.join",
};

export function voiceErrorMessage(code: VoiceNoteRecorderError | HuddleErrorCode): string {
  return t(ERROR_KEYS[code]);
}
