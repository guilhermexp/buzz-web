# Design

## Context

See proposal.md and the pinned comparison in docs/buzz-parity-analysis.md. The web fork already
has real Relay transport, signing, identity storage, chat, Inbox, observers and read-only Git.
Its agent-control service has only a signed allowlisted start/restart operation. The original
workflow finalizer rejects approval gates. Original Huddles use authenticated WS Opus, not WebRTC.

Implementation spans two separately owned Git worktrees/tickets: the web fork and our companion
Buzz backend fork. The existing desktop is a compatibility reference, not a browser-native runtime.

## Goals / Non-Goals

**Goals:** one feature owner per existing web area; complete consumer-visible flows; compatible
signed events and HTTP contracts; controlled remote execution; explicit cross-repo revisions;
real isolated integration evidence, including audio.

**Non-Goals:** copying Tauri OS chrome/updaters, running native processes in a browser, changing
unrelated mobile/desktop behavior, exposing ports publicly, reusing production data/keys, changing
shared agent settings or infrastructure, or reducing the authorized backlog to the first slice.

## Decisions

### Preserve existing owners and protocol boundaries

Extend the existing web feature owners and transport/signing contracts. Port browser-safe editor,
serialization, presentation and preference behavior selectively. Do not wholesale-copy the desktop
app or create parallel transport/policy abstractions for every feature. Browser/private-owner
records remain signed/decrypted by the user identity; server runtime credentials remain server-side.

### Full outcome, ordered integration

Implement in dependency order: UI/session fundamentals; collaboration/catalog/metrics;
project/workflow surfaces and required backend support; remote operations; real-time audio,
voice notes and background push. This is execution order, not separate permission or a reason to
stop after one phase. Every requested capability has a spec and acceptance evidence requirement.

### Owned companion backend rather than patching the reference

Change our `guilhermexp/buzz` fork only where a missing contract or behavior is necessary.
Use compatible event shapes, authorization and tenant context. Approval suspension must persist
run/approval state and resume safely after restart; simply returning an in-memory token is not
sufficient. Avoid unrelated platform migrations or rewriting existing native clients.

### Remote operation authority is explicit

Extend the existing remote service or a narrowly owned companion only where needed. Bind operations
to authenticated owner/community/workspace; validate signed requests, replay, destinations and
current authority. Keep lifecycle/configuration actions distinct from PTY sessions and MCP/file
operations. A remote terminal is an actual PTY inside an explicitly allowed workspace, not an
unrestricted host command endpoint. Files must reject path/symlink escapes. Cancellation and
revocation retire task-owned processes and sessions. No Docker host socket or privileged mount
is exposed to the application or browser.

### Audio uses the actual compatible wire

Preserve the original authenticated Huddle WS endpoint, Opus framing and lifecycle events.
Use browser capture/playout plus a compatible supported codec implementation; inspect actual
browser codec support before selecting native browser codecs versus a maintained WASM codec.
WebRTC-only audio would require a real gateway and is not a silent substitute. Audio integration
uses a real isolated Relay and at least two peers, including a peer using the original compatible
transport/codec contract. Test a known signal in both directions, mute/leave/revocation/reconnect,
permission denial and voice-note uploads. Synthetic input is permitted for automation but its
scope must be declared; physical device acceptance is separate.

### Browser push is a real service-worker feature

Keep opt-in subscriptions private and scoped. Implement the required backend delivery support
rather than pretending existing native push transports are Web Push. Verify actual browser
subscription/delivery and notification navigation with the page closed. A mock push provider or
an in-tab event notification does not satisfy background delivery.

### Real evidence and isolated runtime

Use dedicated generated test identities and task-local database, Redis, object storage, Git repos,
agent workspaces and ports. Rootless Docker tooling is installed and namespace isolation was
smoke-tested on the authorized development host; use a task-owned daemon/runtime/data root, not the default privileged
Docker socket or another project's test services. PostgreSQL 16 binaries are also installed.
Do not run `just setup` against shared defaults. Private material stays in ignored permissioned
runtime files and never appears in stdout, screenshots, traces or commits.

The worker records behavioral RED before each clear bug/new seam and GREEN after implementation,
then runs the component gates and production builds. UI proof uses desktop/mobile screenshots and
actual actions; audio proof records the real path and signal results; backend proof records real
persistence/ref/process changes. Main independently reviews and verifies the final paired commits.

## Risks / Trade-offs

- Large cross-feature scope -> one integration owner, granular commits, explicit per-item matrix;
  no checkbox is complete merely because a component exists.
- Browser codec and permission differences -> capability detection, real compatible audio proof,
  explicit physical-device/browser limits rather than fake fallback.
- Shared box resources -> bounded Cargo/browser parallelism, unique runtime/socket/port paths,
  no killing other sessions/services, preserve caches needed by active work.
- Approval idempotency/restart races -> durable state transitions and unauthorized/replayed decision
  tests, not UI-only approval tests.
- Operator-controlled remote execution -> owner/community/workspace binding, secret redaction,
  bounds and revocation tests; no host-global shell endpoint.
- Background push availability -> actual enrollment/delivery proof; unavailable browser/provider
  prerequisites remain named notProven, never a success claim.

## Migration Plan

Keep existing event contracts and clients usable where possible. Any schema change uses the
repository's migration conventions and a dedicated test database. Deployment docs identify the
required compatible web/backend pair and optional remote runtime service. Work is committed on
isolated feature branches, reviewed and independently verified before Main integrates it.
No production rollout, public exposure, force push or upstream push is authorized for the worker.
