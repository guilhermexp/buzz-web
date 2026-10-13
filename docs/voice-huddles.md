# Voice notes and Huddles (web)

Code: `web/src/features/voice/**`. Copy: `web/src/shared/i18n/messages/voice.ts`.

## Voice notes
- Capture: `getUserMedia` (AEC/NS/AGC on) → AudioWorklet PCM → mono 16-bit PCM WAV at 24 kHz,
  file `voice-note-<ms>.wav`, `audio/wav` (byte-compatible with Buzz Desktop `voiceNoteWav`).
- Max 5 minutes (auto-finish). Discard, finish, failure and unmount stop every capture track and
  close the AudioContext. Permission/insecure-context/device errors are localized toasts.
- The composer keeps the file local and uploads it only on send (Composer slice).

## Huddles (desktop-compatible, wire protocol v2)
- Start: `9007` private `stream` channel `huddle-<id8>` with `ttl 3600`, then `48100` in the parent
  (`{ephemeral_channel_id}`). The microphone is opened first, so a denied permission leaves no room.
- Presence: `48100–48103` on `#h` parent (desktop causal reconstruction) checked against the relay's
  `48104` liveness answer; a fresh start is trusted for 90 s before anyone connects.
- Audio: `ws(s)://relay/huddle/<ephemeral>/audio`, challenge → `{type:"auth", event: 22242,
  parent_channel_id, protocol_version: 2}` → `joined`. Frames out `[seq u16][ts_48k u32][dBov i8][flags]`
  + Opus; in `[peer_index]` + the same. 48 kHz mono, 20 ms, ~32 kbps VBR, voip, DTX.
- Playout: one AudioWorklet mixer with a per-peer jitter buffer (start at 60 ms, cap 240 ms) →
  gain (deafen) → `AudioContext.destination`; output device via `AudioContext.setSinkId` where present.
- Mute stops encoding/sending entirely (and disables the track). Device loss (`ended`) stops capture,
  shows "Microphone unavailable" + Retry; nothing is sent meanwhile.
- Reconnect: backoff 0.5 → 15 s (8 attempts), immediate retry on `online`; capture and AudioContext are
  kept, so reconnecting never opens a second microphone.
- Leave: `{type:"leave"}` + close, then desktop semantics: last human → `48103` + archive (`9002`),
  otherwise `9022` on the ephemeral channel. "Humans" = non-`bot` members of the ephemeral channel's
  `39002` plus non-bot peers live on the audio socket (a relay that auto-adds audio joiners without
  republishing `39002` would otherwise make the creator end the room for everyone). Publishes wait
  out relay `rate-limited` replies.
- Controls: the dock (roster, mic, deafen, devices, reactions, leave) sits above the channel timeline
  and above every full-surface tool view (`ToolSurfaceExtras` slot), with a link back to the channel.
- Revocation: relay `membership_revoked` (terminal, no reconnect) or relay-signed `44101` with `p`=self
  and `h`=parent tears the session down immediately. Sign-out/identity switch/page hide also tear down.
- Reactions: kind `24810` on the ephemeral channel (`reaction`, `sender_name` tags), quick set.

## Codec / browser matrix
| Browser | Encoder | Decoder | Status |
| --- | --- | --- | --- |
| Chromium (Playwright 1234) | WebCodecs `AudioEncoder` opus | WebCodecs `AudioDecoder` | Live-tested against relay + libopus native peer (synthetic audio) |
| Firefox (Playwright 1538) | WebCodecs if `isConfigSupported`, else WASM | same | Covered by `live-voice-controls.spec.ts`; see slice report for the run result |
| Safari / others without WebCodecs audio | `libopus-wasm` (libopus → WASM, lazy chunk) | `libopus-wasm` | Fallback unit-tested in Node (20 ms mono packets, round-trip tone) |

Both paths emit standard raw Opus packets (libopus), interoperable with desktop and native peers.
libopus / libopus-wasm licensing: see `THIRD_PARTY_NOTICES.md`.

## Evidence scope
Automated runs use SYNTHETIC input (Chromium `--use-file-for-fake-audio-capture` gated tones, Firefox
fake device, native libopus tone) and measure played output through Web Audio analysers. They do not
validate physical microphones, speakers, echo cancellation quality or human listening.

## Verification
- Frozen witness: `web/tests/e2e/live-voice.spec.ts` (`playwright.live-voice.config.ts`).
- Recovery + Firefox: `web/tests/e2e/live-voice-controls.spec.ts` (`playwright.live-voice-controls.config.ts`),
  same environment variables as the witness.
- Unit: `npx vitest run src/features/voice`.
