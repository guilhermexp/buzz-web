# Spec Delta

## Purpose
Let browser users participate in actual Buzz channel audio sessions and exchange voice messages with compatible clients.

## ADDED Requirements

### Requirement: Real interoperable Huddle audio
Authorized members SHALL create/join and leave Huddles with actual bidirectional audio compatible with Buzz's authenticated WebSocket Opus transport. A visual participant state or loopback-only audio effect SHALL NOT substitute for peer audio.

#### Scenario: Audio between browser and compatible peer
- **WHEN** an authorized browser participant speaks to a compatible peer through the actual Relay
- **THEN** the intended audio reaches and is decoded/played by the other participant and audio in the reverse direction reaches the browser

### Requirement: Participant and room lifecycle
The client SHALL maintain compatible room lifecycle, membership, participant presence and supported reactions; leaving or losing authorization SHALL stop capture, transmission and private-room access.

#### Scenario: Leave or lose membership
- **WHEN** a participant leaves or is removed from the private channel
- **THEN** the room state updates and the participant no longer sends, receives or captures the room's audio

### Requirement: Browser audio controls and recovery
The UI SHALL expose microphone permission, device selection, mute/deafen and useful connection/error recovery with secure-context requirements and no background capture after leaving.

#### Scenario: Microphone denied or device removed
- **WHEN** permission is denied or a selected device becomes unavailable
- **THEN** the UI reports a recoverable error without claiming active audio capture or remaining in a success-looking call

#### Scenario: Muting and reconnecting
- **WHEN** a participant mutes or reconnects after interruption
- **THEN** transmitted audio and participant state match the chosen controls without duplicate capture or stale sessions

### Requirement: Voice messages
Users SHALL record, preview, cancel, upload and play voice notes using supported media contracts, with duration/size validation and correct conversation attribution.

#### Scenario: Voice note round trip
- **WHEN** web records and uploads a voice note in a channel or thread
- **THEN** another authorized client can play the actual uploaded audio in that conversation and cancellation sends no message

### Requirement: Honest audio evidence
Audio acceptance SHALL include measured real peer/Relay delivery and playback, permission/authorization failures and cleanup. Synthetic microphone input used for automation SHALL be identified; it SHALL NOT be reported as physical-device validation.

#### Scenario: Automated audio verification
- **WHEN** automated verification uses known synthetic audio through real browser capture/codec/transport
- **THEN** evidence identifies the source, transmitted/received signal and scope, and any physical-device checks not performed remain explicit
