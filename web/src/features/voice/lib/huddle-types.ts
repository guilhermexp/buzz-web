import type { AudioDevice, MicrophoneErrorCode } from "@/features/voice/lib/microphone";

export const KIND_HUDDLE_STARTED = 48100;
export const KIND_HUDDLE_PARTICIPANT_JOINED = 48101;
export const KIND_HUDDLE_PARTICIPANT_LEFT = 48102;
export const KIND_HUDDLE_ENDED = 48103;
export const KIND_HUDDLE_LIVENESS = 48104;
export const KIND_HUDDLE_REACTION = 24810;
export const KIND_MEMBER_REMOVED_NOTIFICATION = 44101;
export const HUDDLE_LIFECYCLE_KINDS = [
  KIND_HUDDLE_STARTED,
  KIND_HUDDLE_PARTICIPANT_JOINED,
  KIND_HUDDLE_PARTICIPANT_LEFT,
  KIND_HUDDLE_ENDED,
];

export type HuddleErrorCode =
  | MicrophoneErrorCode
  | "deviceLost"
  | "revoked"
  | "ended"
  | "full"
  | "unsupported"
  | "notMember"
  | "auth"
  | "codec"
  | "connection"
  | "start"
  | "join";

export type HuddlePhase = "idle" | "starting" | "joining" | "connected" | "reconnecting";

export type HuddleParticipant = { pubkey: string; self: boolean; speaking: boolean };

export type HuddleReaction = { id: string; pubkey: string; emoji: string; senderName: string };

export type HuddleSnapshot = {
  phase: HuddlePhase;
  parentChannelId: string | null;
  ephemeralChannelId: string | null;
  isCreator: boolean;
  muted: boolean;
  deafened: boolean;
  /** Capture is not running (device removed/failed); the session listens only. */
  microphoneLost: boolean;
  participants: HuddleParticipant[];
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  outputSelectable: boolean;
  error: HuddleErrorCode | null;
  reactions: HuddleReaction[];
};

export const IDLE_HUDDLE: HuddleSnapshot = {
  phase: "idle",
  parentChannelId: null,
  ephemeralChannelId: null,
  isCreator: false,
  muted: false,
  deafened: false,
  microphoneLost: false,
  participants: [],
  inputs: [],
  outputs: [],
  inputDeviceId: null,
  outputDeviceId: null,
  outputSelectable: false,
  error: null,
  reactions: [],
};
