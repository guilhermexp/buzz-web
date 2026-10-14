# Proposal

## Why

The adopted Buzz Web fork resembles Buzz Desktop but lacks important editing, collaboration,
agent, project and platform workflows. The owner has now authorized one remote OMP worker
to implement the entire comparison backlog, explicitly including voice, rather than stop at a UI demo.

## What Changes

- Align the existing shell, typography/density, composer, emoji/GIF/clipboard interactions,
  sidebar organization, thread modes, Inbox, search, channel entry actions, preferences and
  multi-community navigation while preserving responsive mobile behavior.
- Deliver Canvas/history/conflict handling, complete forums, persistent reminders, Pulse and
  authorized content/archive exports alongside existing encrypted identity portability.
- Deliver agent activity/history, owner-scoped usage/memory, lifecycle and configuration,
  persona/team catalogs and safe runtime installation/management through an explicit remote service.
- Deliver project collections, issues, PRs, review/diffs and actual authenticated Git writes/merge.
- Deliver workflow definitions, triggers, runs/traces and persisted approval/deny/resume behavior.
  Correct the necessary workflow-engine gap in the separate owned Buzz backend fork.
- Deliver real browser Huddles, interoperable WebSocket Opus audio, participant/lifecycle state,
  microphone/device/mute controls, error recovery and voice-note capture/upload/playback.
- Deliver opt-in Web Push/background notifications and a real authorized remote PTY/files/MCP surface,
  without importing native window, updater or credential-store behavior into the browser.
- Add isolated real-Relay/runtime journeys, negative authorization cases, audio evidence,
  production builds, documentation and a per-item completeness report. No inert controls or
  fixture-only feature claims are acceptable.

## Capabilities

### New Capabilities

- `workspace-ui`: desktop-aligned browser shell, composer, navigation, preferences and community sessions.
- `channel-collaboration`: documents, forums, productivity feeds/reminders and authorized export.
- `agent-operations`: observable remote agents, lifecycle/configuration and private/shared catalogs.
- `project-forge`: project/repository collections, work items, review and real Git write outcomes.
- `workflow-execution`: workflow authoring, run traces and real persisted approval-gated execution.
- `voice-huddles`: interoperable real-time channel audio and browser voice messages.
- `browser-notifications`: permission-aware service-worker background push and notification navigation.
- `remote-workspace`: authorized remote PTY, scoped filesystem and MCP operations.

### Modified Capabilities

None: the repository did not have existing OpenSpec capability specs.

## Impact

Primary product: `guilhermexp/buzz-web` (`web/`, `agent-control/`, deployment, tests and docs).
Companion implementation: owned `guilhermexp/buzz` backend fork (`crates/`, protocols, migrations,
agent/runtime interfaces and tests) under a separate ticket/worktree, not `block/buzz` or the
read-only comparison checkout. The desktop remains a compatibility reference; native-only OS
chrome/updaters are not browser parity requirements.

Baseline references are recorded in `docs/buzz-parity-analysis.md`. This implementation mandate
supersedes that document's earlier planning-only status; its priorities are execution ordering,
not permission to omit later items. New authority is required for public deployment, production
credentials/data, destructive infrastructure changes or a reduction of the requested outcome.
