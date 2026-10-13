# Tasks

## 1. Isolated baseline and integration runtime

- [x] 1.1 Read both owned repository instructions and the pinned comparison; record exact revisions and environment/tool capabilities in the run report before code changes.
- [x] 1.2 Provision task-owned Relay/database/Redis/object-store/Git/agent-workspace resources and generated test identities; verify readiness and that no shared/default production resource is used.
- [ ] 1.3 Record behavioral RED at each clear bug/new seam before correction and GREEN after; retain commands, final witness files and logs rather than treating installation failure as RED.

## 2. Workspace UI and community sessions

- [x] 2.1 Align shell/frame/spacing/type tokens with the desktop reference; verify consistent-state desktop/mobile captures and document intentional browser differences.
- [ ] 2.2 Implement rich composition with compatible formatting/mentions and preserved drafts, IME and keyboard sending; verify formatted web-to-desktop messages and scoped draft recovery.
- [ ] 2.3 Implement emoji/custom emoji, supported GIFs and clipboard attachments; verify actual rendering/upload, invalid-media rejection and localized errors, updating feature docs.
- [x] 2.4 Implement sidebar sections, context actions and reordering through the correct preference contracts; verify reload/shared-state behavior and unread/favorite/mute preservation.
- [x] 2.5 Add thread focus/split modes without replacing the existing owner; verify parent attribution, draft isolation and mobile back/close behavior.
- [x] 2.6 Align Inbox/search result hierarchy and useful grouping/actions; verify exact source navigation, keyboard focus and denied/empty/error states.
- [x] 2.7 Align channel intro/details/add-agent/add-member flows; verify real permission-aware operations and failed writes without optimistic success.
- [x] 2.8 Add independent font-size/density and browser preferences; verify reload and unclipped desktop/mobile surfaces, documenting controls.
- [x] 2.9 Implement multiple saved community sessions; verify no cross-Relay/identity cache, draft, profile, notification or subscription leakage.
- [x] 2.10 Complete English/Chinese copy, keyboard/a11y and responsive coverage for this group; run relevant behavioral tests and document the supported UI/host boundary.

## 3. Channel collaboration and productivity

- [x] 3.1 Implement Canvas read/edit/history/restore with compatible compare-and-swap; verify two-client stale-write rejection and unauthorized private-channel access, adding tests/docs.
- [x] 3.2 Complete forum creation/metadata/replies/sorting/moderation/unread behavior; verify a real topic lifecycle and role rejection across clients, adding tests/docs.
- [x] 3.3 Implement persistent reminders and Inbox draft/productivity actions; verify reload/cross-client recovery and author-private reminder reads, adding tests/docs.
- [x] 3.4 Implement the compatible Pulse feed and interactions; verify actual Relay publication and source navigation, adding tests/docs.
- [x] 3.5 Implement supported authorized content/history and agent/team snapshot export/import while preserving identity backup; open resulting files and verify usable scoped content without secrets, adding tests/docs.

## 4. Agent operations and catalogs

- [x] 4.1 Preserve live observers and add real authorized durable history/session/log inspection; verify a real task's live and historical outcomes without inventing persistence for ephemeral frames.
- [x] 4.2 Add owner-private metrics/cost and memory surfaces; verify authorized decryption and rejection/absence for a different member, adding tests/docs.
- [x] 4.3 Implement real remote agent registration/create/configure/start/stop/restart/remove with current authority and secret-safe state; verify actual process transitions, cleanup, presence and replay rejection, adding tests/docs.
- [x] 4.4 Implement persona/team catalog CRUD, sharing, import/export and runtime application; verify persistence, sanitized shared projections and private-entry isolation, adding tests/docs.
- [x] 4.5 Implement compatible channel access and response-policy management; verify actual membership/policy changes and revocation during an active session, adding tests/docs.

## 5. Project forge

- [x] 5.1 Implement project collections and repository publish/import/nested browsing; verify real metadata and Git content while preserving remotes, adding tests/docs.
- [x] 5.2 Implement issues and PR lists/counts/authoring/state transitions; verify cross-client persisted work items rather than empty tabs, adding tests/docs.
- [x] 5.3 Implement actual revision-linked diff/review/comment/approval; verify intended revision and persisted review retrieval, adding tests/docs.
- [x] 5.4 Implement authorized Git writes/merge through transport; inspect actual refs/commit graph and prove protected-ref rejection, adding tests/docs.

## 6. Workflows and companion backend

- [x] 6.1 Implement workflow list/editor/validation/trigger/schedule/webhook surfaces; verify persisted definitions and attributable real runs without public webhook secrets, adding tests/docs.
- [x] 6.2 Implement durable run/step/trace/error/approval detail and recovery; verify actual backend records after reconnect, adding tests/docs.
- [x] 6.3 Correct the owned backend approval-gate finalization/persistence/resume path; verify suspended state and restart recovery, authorized approval, denial, expiry/cancellation where supported and no duplicate continuation, adding regression tests/docs.
- [x] 6.4 Verify web approval/denial against the corrected backend, including invalid/replayed decisions and connection loss; observe the run's terminal outcome instead of only an accepted event.

## 7. Real voice and Huddles

- [x] 7.1 Implement compatible room creation/join/leave and participant/lifecycle/reaction UI; verify actual authenticated room state, membership and cleanup, adding tests/docs.
- [x] 7.2 Implement browser capture, compatible Opus encode/decode/wire transport and playout; prove bidirectional known audio through a real Relay with two peers including the original compatible transport contract.
- [x] 7.3 Implement microphone permission/device selection/mute/deafen and reconnect; prove denied permission, removed device, mute behavior and no capture after leave, adding tests/docs.
- [x] 7.4 Prove private-room revocation stops audio access and session-owned resources; retain signal/transport and authorization evidence, not only screenshots.
- [x] 7.5 Implement record/preview/cancel/upload/play voice notes; verify actual uploaded audio and thread/channel attribution in a second client, adding tests/docs.
- [x] 7.6 Record which audio sources and browsers were exercised, separating synthetic-input automation from physical microphone/speaker acceptance; document supported codec/browser limits without omitting the feature.

## 8. Browser background notifications

- [x] 8.1 Implement opt-in subscription/revocation and private backend storage with service-worker support; prove denied/revoked enrollment and document deployment prerequisites.
- [x] 8.2 Implement actual push delivery for eligible events; observe a real browser notification with the app tab closed rather than substitute an in-tab event or mock provider.
- [x] 8.3 Implement notification navigation and stale-enrollment retirement; prove exact scoped event navigation and removal/sign-out privacy, adding tests/docs.

## 9. Remote workspace tools

- [x] 9.1 Implement a real authorized workspace PTY with input/output/resize/cancel/reconnect and bounded lifecycle; prove actual command effects and process cleanup, adding tests/docs.
- [x] 9.2 Implement scoped files and upload/download/edit operations; prove allowed persistence and path/symlink-escape rejection, adding tests/docs.
- [x] 9.3 Implement authorized MCP tool connection/invocation/result/error/cancel; prove real workspace effects and rejection for another owner, adding tests/docs.
- [x] 9.4 Prove owner/community/workspace binding, replay rejection, revocation and secret-safe output across terminal/files/tools; no unrestricted host-global proxy is acceptable.

## 10. Integrated completion

- [ ] 10.1 Run the frozen component code gates, production builds and real-Relay/runtime/browser/audio acceptance at the final paired revisions; record every requested item's status and exact evidence/limits.
- [ ] 10.2 Reconcile docs/changelog and supported web/backend deployment pair, commit all scoped changes on the owned feature branches and deliver reports, logs, screenshots/audio and reproducible verification instructions to Main.

## Open items (2026-10-13 run)

- 1.3: backend RED→GREEN is complete (`e2e_workflow_approval` 4/4). The frozen web witness passes
  its voice-note test, and every huddle assertion passes, but it cannot exit 0 because the frozen
  support helper `NativeHuddlePeer.close()` never settles `streamTone()`; a minimal fix awaits
  Main's authorization (see the web run report).
- 2.2: formatting, mentions, drafts, IME guards and keyboard sending are implemented and verified
  web-to-web against a real Relay, with event content checked against the desktop Markdown and tag
  contract. No Buzz Desktop runtime was available, so web-to-desktop rendering is unverified.
- 2.3: emoji, custom emoji (NIP-30) and clipboard/drop attachments are verified live. GIF results
  need the operator's KLIPY key (the Relay hard-codes the provider), so only the explained
  unavailable state is verified.
- 10.1/10.2: see the run reports for gate results, known environment failures and the remaining
  witness decision.

## Workflow follow-up

- Main obtains independent code review and verification of both repository snapshots, resolves findings, accepts the complete outcomes and integrates/publishes only under the owner's authority.
- Cleanup retains evidence and active previews but removes finished task-owned services/build caches/worktrees when no longer needed; never touch other box sessions or shared runtime resources.
