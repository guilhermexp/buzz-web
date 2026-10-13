# Buzz desktop parity analysis

Date: 2026-10-13. Status: comparison and proposed priorities, not feature implementation or a
claim of desktop parity.

## Baselines and scope

| Role | Repository | Revision |
| --- | --- | --- |
| Our browser client | [guilhermexp/buzz-web](https://github.com/guilhermexp/buzz-web), fork of [hardy4yooz/buzz-web](https://github.com/hardy4yooz/buzz-web) | `9718473903f58ccabff9292bd793eae7cb75bb6c` |
| Desktop and protocol reference | [block/buzz](https://github.com/block/buzz) | `1d9f2c81a5583f12be1239a088e2f0b379292dc3`; desktop package `0.5.28` |

The comparison targets `block/buzz/desktop`, its Relay and agent contracts, not the original
repository's smaller `web/` package. `block/buzz-app` is a separate new application, not this
comparison's visual reference. Keep `origin` pointed at our fork and `upstream` at the independent
browser client. Preserve Apache-2.0 attribution and the existing third-party notices; copyright
permission does not grant trademark rights.

Evidence types below are explicit:

- **Code:** inspected implementation at the pinned revisions.
- **UI:** interaction observed in Chromium with the projects' existing fixtures/demo.
- **Proposal / [INFERENCE]:** a recommended adaptation, not a working or verified feature.

## Findings

The web client already shares the recognizable gradient shell, inset content surface, Inter
font, channels/DMs, Inbox, agent cards, message actions, mentions, uploads, search and thread panel.
It is not an empty scaffold. The biggest gaps are editor capability, shell organization and
readability preferences, followed by collaborative documents and remote agent operations.

There is no single portable desktop frontend to copy unchanged. Even the desktop rich-text
editor imports native clipboard access. Feature UI, browser-safe policy and serialization can be
reused selectively; Tauri commands, subprocesses and native credential access cannot.

## UI alignment matrix

Priorities are proposed implementation order: P1 = first alignment slice, P2 = subsequent
functional/surface work, P3 = optional or host-dependent expansion. They are not bug severities.

| Surface | Current web versus desktop | Recommended change | Priority | Evidence |
| --- | --- | --- | --- | --- |
| Shell and content frame | Same visual family; web adds a fixed icon rail and a tighter frame, while desktop has different insets, rounded surface and chrome. | Align surface/inset/radius tokens and desktop-width composition. Do not replace the web shell wholesale. | P1 | [W-shell], [W-style], [D-shell], UI chat captures |
| Typography and density | Both use Inter. Desktop has independent font-size and conversation-density preferences; web has fixed conversation spacing and a theme selector. | Bring over the conversation type/spacing contract and expose font size/density in Appearance. Keep browser zoom independent. | P1 | [W-style], [D-type] |
| Message composer | Web uses a textarea, mentions and attachment picker. Desktop has TipTap, formatting, emoji and additional media affordances. | Port the editor/toolbar behavior while adapting clipboard and preserving existing drafts, mentions, attachment validation, IME and send semantics. | P1 | [W-composer], [D-editor], UI formatting toolbar |
| Sidebar organization | Web has channels/forums/DM groups and favorite/mute indicators. Desktop has richer sections, context menus and drag/reorder behavior. | Add the useful organization/context actions. First resolve what is local preference versus shared Relay state; do not introduce a second persistence model. | P1 | [W-nav], [D-sidebar] |
| Thread modes | Web already opens a right-hand thread panel and has a thread composer. Desktop also has thread display preferences/modes. | Extend the existing panel with focus/split behavior and matching controls; preserve mobile navigation and draft isolation. | P2 | [W-thread], [D-thread], UI thread capture |
| Inbox | Web already has list/detail, mentions/DM/thread/approval filters and source navigation. Desktop has richer grouping/actions, including reminders. | Align rows, header and action placement. Add only actions with an actual persistence contract, not a decorative button. | P2 | [W-inbox], [D-inbox], UI Inbox captures |
| Search | Both already expose global search and keyboard shortcuts. Presentation and result/actions differ. | Align result hierarchy, channel context and keyboard focus without replacing working search with a visual-only field. | P2 | [W-nav], [W-dialogs], [D-sidebar] |
| Channel details and onboarding | Web has member/details panels with favorite, mute and archive. Desktop has richer channel introduction and add-agent/add-member affordances. | Bring useful entry actions and metadata into the existing header/details, with permission-aware controls. | P2 | [W-shell], [W-details], UI chat captures |
| Agents | Card/grid presentation and team headings already resemble desktop. Web controls discovery, channel access, DMs and optional remote start; it does not provide native agent creation/configuration. | Keep visual alignment separate from real lifecycle/configuration work. Do not describe channel-derived groups as persisted team management. | P2 | [W-agents], [W-control], UI Agents captures |
| Multi-community | Web runtime configuration selects one Relay. Its fixed rail is not a full community switcher. | Design relay/identity-scoped sessions, caches, drafts and read state before adding desktop-like community icons/switching. | P2 | [W-config], [W-nav], [W-roadmap] |
| Settings and desktop chrome | Web has Profile, Appearance, Invites and Identity. Native updates, OS drag regions and local process settings are not browser features. | Add useful browser preferences; omit native-only chrome and settings. Browser history controls are a separate navigation behavior change. | P2/P3 | [W-settings], [D-shell] |
| Mobile | The web already has responsive navigation and a bottom action bar; a thread and channel composer were observed at 390 px. | Preserve the browser/mobile adaptation rather than shrinking the desktop layout unchanged. | Constraint | [W-nav], UI mobile capture |

### Selective reuse

1. Surface, typography and conversation tokens: adapt into the existing web style owner.
2. Rich-text editor policies and toolbar: keep Markdown/event serialization compatible and
   replace native clipboard dependencies, not the web transport.
3. Sidebar section/context-action presentation: reuse the interaction model after checking
   preference persistence and permissions.
4. Thread-view controls/preferences: extend the current `ThreadPanel`, not a second thread UI.
5. Agent card/detail presentation: reuse layout while retaining remote-versus-local capability
   distinctions.

## Useful capabilities for the browser client

This table is a proposed backlog, not authorization to implement every desktop feature.
The browser remains a client of the existing Relay. A remote control service is a separate
component with explicit authorized operations, not a generic CLI/shell proxy.

| Capability | Current web | Browser path / boundary | Proposed priority |
| --- | --- | --- | --- |
| Canvas / collaborative channel documents and history | No document editor in the current workspace surface. | Add an authenticated Relay-backed document/history surface; keep source-of-truth and conflict behavior compatible with desktop. | P1 after the basic UI slice |
| Rich text, emoji and clipboard attachments | Mentions, Markdown rendering and uploads exist; the composer itself is still a textarea. | Browser editor/clipboard APIs plus the existing upload/event path. Voice/GIF require their own capability/permission checks. | P1 |
| Agent activity | Live observer UI exists; durable observer history and a full control plane remain planned. | Kind `24200` is ephemeral; an open tab's buffer is not historical storage. Keep it separate from durable per-turn metrics. | P1/P2 |
| Agent usage/cost and memory inspection | No owner-scoped metrics or memory surface. | Metrics kind `44200` and engrams kind `30174` are existing Relay contracts; reading/decryption can stay with an authorized owner signer. This does not require a general remote shell or give access to runtime secrets. | P2, read-only first |
| Agent start/stop/restart and configuration | Optional start/restart of an allowlisted systemd service; no general stop/configuration endpoint. | Extend typed remote control operations only where a runtime is available. The browser must not receive provider credentials or agent private keys. | P2 |
| Personas and persisted teams | Agent discovery and channel-derived team display, not desktop-equivalent editing/import/versioning. | Separate Relay catalog metadata from filesystem/runtime installation and secret custody. | P2 |
| Workflow list/editor/run traces | Inbox already publishes approval/denial events; full authoring and run views are missing. | Definition/trigger/run inspection can reuse existing contracts. Approval-gated execution is currently blocked in the original workflow engine; a web button cannot fix that backend gap. | P2; gated execution blocked upstream |
| Reminders / productivity actions | Inbox exists; reminders and richer grouping remain planned. | Persist through the appropriate Relay-backed contract if cross-device behavior is promised. Do not silently substitute device-local state. | P2 |
| Projects / Git / issues / PRs / review | Read-only NIP-34 repository browsing exists. Publishing, issues/PRs/review/merge are missing. | Reuse signed work-item/review contracts and the Relay's authenticated Smart HTTP for Git. A status event is not proof of a merge; no arbitrary server Git/shell proxy is needed. | P2; writes incrementally |
| Complete forums | Forum navigation/content can be discovered, but full creation, topic metadata, sorting and moderation remain planned. | Browser + Relay, gated by advertised features and membership. | P2 |
| Export / archive / portable identity | Encrypted identity backup/restore exists; broader workspace/history export is a different feature. | Keep private-key export distinct from content export, and do not expose another member's or channel's data. | P2/P3 |
| Huddles / voice | No Huddle client; roadmap lists it as platform research. | Original Buzz uses a WebSocket Opus audio relay. [INFERENCE] Browser audio needs a compatible capture/codec/transport path or a deliberately designed gateway; WebRTC is not a drop-in replacement. | P3 |
| Terminal / MCP / local files | Not available as a browser workspace tool. | `buzz-acp`, `buzz-dev-mcp`, CLI and runtime processes belong on an authorized server/worker. A remote terminal requires its own security and lifecycle contract. | P3, not a direct port |
| Web Push / background notifications / Pulse | Planned, not equivalent to native notifications or the full desktop Pulse surface. | Browser/platform capabilities and supported server contracts; do not claim notifications while the page is closed from in-tab updates. | P3 |

### Existing remote-start boundary

`agent-control/server.mjs:61-105` accepts only an authenticated `POST /start`, resolves a configured
agent public key to an allowlisted systemd unit and starts/restarts that unit. Other action routes
return 404. It checks service activity after the operation. This is useful reuse, but it is not
agent creation, a terminal, stop/configuration support, or a complete runtime manager. See
[the current service documentation](../agent-control/README.md).

The current web `AgentsView.tsx:314-320,489-515` constructs displayed teams from channel membership.
Its defaults popover (`:342-355`) displays policy/count information; it is not the desktop defaults
editor. These visual similarities must not be counted as full capability parity.

### Reusable protocol contracts

- **Canvas:** kind `40100`, channel tag `h`, with `expected-revision` for compare-and-swap.
  `buzz-sdk/src/builders.rs:557-582` accepts a loaded head id or `none`; the second writer must
  observe a conflict rather than silently overwrite the first writer. This is more useful than a
  local Markdown editor that only resembles the desktop document.
- **Workflow views:** definitions kind `30620`, trigger kind `46020`, and NIP-98-authenticated
  `/workflows/{id}/runs` and `/workflows/{id}/runs/{run_id}/approvals`. Run traces are HTTP-backed
  data, not just message events. Respect channel membership and additional Relay admission rules.
  The web's `use-inbox.ts:412-443` already publishes `46030` / `46031`; do not list those buttons as
  a missing feature or count publication alone as resumed execution.
- **Agent observability:** kind `24200` is ephemeral observer telemetry, while kind `44200`
  stores NIP-44-encrypted per-turn usage for the owner. Engrams (`30174`) and private managed-agent
  aggregates (`30179`) have different privacy/payload contracts; a public agent profile is not
  interchangeable with either. Use the owner signer for authorized decryption.
- **Catalogs:** persona kind `30175` is author-only unless explicitly shared; team catalog
  projection kind `30178` exposes sanitized shared definitions. Importing a catalog entry and
  installing/running it are different operations. Do not treat channel-derived groups as the
  desktop team catalog.
- **Projects:** repository announcements `30617`, project collections `30621`, PRs `1618`,
  issues `1621` and signed review/status content can drive useful browser surfaces. Preserve the
  existing authenticated Git client and distinguish a review/status change from an actual
  Smart HTTP `git-receive-pack` merge/push.
- **Reminders:** kind `30300` is author-only, with the target/note/state NIP-44 encrypted and
  `not_before` as a public scheduling tag. Browser support must retain privacy and reload/cross-device
  semantics; a local timer is not equivalent.

The exact event registry is
[buzz-core/src/kind.rs](https://github.com/block/buzz/blob/1d9f2c81a5583f12be1239a088e2f0b379292dc3/crates/buzz-core/src/kind.rs).
These are code-inspected reuse candidates, not live-verified browser implementations.

### Workflow documentation caveat

The original approval limitation is confirmed in current code, not merely an old vision note.
`crates/buzz-workflow/src/executor.rs:725-743` returns an in-memory `Suspended` result, but
`WorkflowEngine::finalize_run` in `crates/buzz-workflow/src/lib.rs:229-256` explicitly marks that
run `Failed` with `approval_not_supported` instead of persisting a reachable `WaitingApproval`
state. The web already signs grant/deny events, but that does not make approval-gated workflows
operational. Treat backend support as a prerequisite outside this web-only comparison.

## Recommended delivery sequence

1. **Baseline acceptance:** run the existing dedicated-identity real-Relay checks and current
   desktop interoperability checks before advertising production parity. Demo UI is not that gate.
2. **First UI slice:** align frame/spacing/type tokens, font size/density, composer and its toolbar,
   with current drafts/mentions/uploads preserved. Add sidebar context/organization in the next
   focused slice rather than a simultaneous full shell rewrite.
3. **Collaboration:** Canvas/history, thread focus modes and persistent Inbox actions, using the
   existing Relay contracts and permission rejection behavior.
4. **Remote agent operations:** durable activity/history, session/log inspection, safe lifecycle
   actions, then configuration/personas/teams where the required backend exists.
5. **Workflow/project work:** list/detail/run traces first, then individual authorized authoring,
   review and Git writes. Voice, terminal and Web Push remain separate platform work.

Before each implementation slice, select its complete user outcome and confirm the current
contract at the pinned source or a newly recorded revision. Use OpenSpec for a selected durable
change; this comparison does not authorize importing every proposed backlog item.

### Acceptance outcomes for the first slices

- Send formatted content and mentions from web, read it in desktop, reply from desktop and see it
  in the correct web thread; reload without losing an unsent scoped draft.
- Change font size/density without changing the stored conversation or causing desktop/mobile
  clipping; restore the preference after reload.
- Edit a channel document in one client and observe the intended document/history state in the
  other, including a rejected write from an unauthorized member.
- Request an agent action, observe actual remote process state and its Relay presence, then inspect
  the relevant session/activity without exposing another channel's data or credentials.
- After the workflow engine supports persisted approval gates, request approval, observe suspension,
  approve as an authorized identity and observe resumed/completed execution; reject an unauthorized
  approval without a success-looking UI. The current pinned engine cannot satisfy this outcome.

## Verification performed and limits

- The fork was created through GitHub and cloned with `origin` and `upstream` separated.
- Production web build (`npm run build`, Node.js 24.21.0) passed on the fork's baseline sources.
- Web chat, thread, Inbox, Agents and a 390 × 844 mobile layout were exercised in the existing demo.
- Original desktop React chat, formatting toolbar, Inbox and Agents were exercised in Chromium
  through its existing `?e2e=mock` IPC bridge, not a packaged native desktop.
- Desktop-size captures used 1440 × 900 viewports. The datasets differ: this is qualitative visual
  comparison, not a pixel-match score. Local screenshots/observations are retained in `.tmp/` and
  are not shipped in the source repository.
- No real identity, Relay database, provider credential, systemd service or agent runtime was used.
  The original fixture shell attempted `/info` on `localhost:3000`; those requests failed because
  no Relay was launched. The fixture UI still rendered. This is not native or live-Relay acceptance.
- No product feature, protocol or UI implementation was changed in this comparison.

## Source pointers

Web pointers are relative to this repository; desktop pointers are pinned to the original revision.

[W-shell]: ../web/src/features/chat/ui/BuzzWebApp.tsx
[W-style]: ../web/src/shared/styles/globals.css
[W-composer]: ../web/src/features/chat/ui/MessageComposer.tsx
[W-nav]: ../web/src/features/chat/ui/AppNavigation.tsx
[W-thread]: ../web/src/features/chat/ui/ThreadPanel.tsx
[W-inbox]: ../web/src/features/inbox/ui/InboxView.tsx
[W-dialogs]: ../web/src/features/chat/ui/AppDialogs.tsx
[W-details]: ../web/src/features/chat/ui/ChannelDetailsPanel.tsx
[W-agents]: ../web/src/features/agents/ui/AgentsView.tsx
[W-control]: ../agent-control/server.mjs
[W-config]: ../web/src/shared/config/runtime-config.ts
[W-settings]: ../web/src/features/chat/ui/SettingsDialog.tsx
[W-roadmap]: ../ROADMAP.md
[D-shell]: https://github.com/block/buzz/blob/1d9f2c81a5583f12be1239a088e2f0b379292dc3/desktop/src/app/AppShell.tsx#L763-L948
[D-type]: https://github.com/block/buzz/blob/1d9f2c81a5583f12be1239a088e2f0b379292dc3/desktop/src/shared/styles/globals/typography.css#L1-L65
[D-editor]: https://github.com/block/buzz/blob/1d9f2c81a5583f12be1239a088e2f0b379292dc3/desktop/src/features/messages/lib/useRichTextEditor.ts#L1-L52
[D-sidebar]: https://github.com/block/buzz/blob/1d9f2c81a5583f12be1239a088e2f0b379292dc3/desktop/src/features/sidebar/ui/AppSidebar.tsx#L624-L759
[D-thread]: https://github.com/block/buzz/blob/1d9f2c81a5583f12be1239a088e2f0b379292dc3/desktop/src/features/channels/ui/ThreadPanelSurface.tsx#L15-L44
[D-inbox]: https://github.com/block/buzz/blob/1d9f2c81a5583f12be1239a088e2f0b379292dc3/desktop/src/features/home/ui/InboxListPane.tsx#L55-L75
