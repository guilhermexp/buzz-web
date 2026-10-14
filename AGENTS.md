# AGENTS.md

This file defines repository-wide rules for coding agents and automated contributors. Human
contributors should also read [CONTRIBUTING.md](CONTRIBUTING.md). Instructions in a more deeply
nested `AGENTS.md`, if one is added later, take precedence for that subtree.

## Fork Direction

This is Guilherme's fork, `guilhermexp/buzz-web`, with `hardy4yooz/buzz-web` retained as
`upstream`. Keep `main` as the integration branch and preserve upstream attribution.
`block/buzz` is the desktop/protocol reference, not another source tree to bundle into this client.
The baseline comparison and proposed priorities are in
[Buzz desktop parity analysis](docs/buzz-parity-analysis.md).

Align the existing interface with Buzz Desktop without sacrificing browser/mobile behavior.
Separate browser-and-Relay features from operations requiring a remote runtime. A comparison or
demo is not feature acceptance; do not claim desktop parity from screenshots or fixture tests.

The owner authorized the full backlog, including voice and necessary companion-backend work,
on 2026-10-13. The implementation contract is
[complete-web-desktop-parity](openspec/changes/complete-web-desktop-parity/proposal.md);
its specs and checklist control completeness. The earlier comparison's priorities are ordering,
not permission to omit features. Backend changes belong to the separately owned
`guilhermexp/buzz` worktree/ticket, never the read-only reference or upstream repositories.

## Project Boundary

Buzz Web is a browser client for an existing Buzz Relay. Keep these boundaries explicit:

- `web/` is the React/Vite single-page application. It may use Relay WebSocket and HTTP protocols,
  browser storage, and browser-safe libraries.
- `agent-control/` is an optional, separately deployed Node service that maps authorized signed
  requests to exact systemd units.
- `deploy/` packages the Web client only. It must not create, migrate, or mutate Relay databases,
  buckets, Git storage, networks, or credentials.
- The Relay, desktop/mobile clients, and agent runtimes are upstream or external systems. Do not
  copy server behavior into the browser to simulate a feature.

If a requested action has no implemented and authorized backend operation, hide it and record the
gap in the Roadmap. Do not ship a control that only changes local presentation while implying a
Relay write succeeded.

## Repository Map

```text
web/src/app/                 router and application shell
web/src/features/            feature-owned UI, hooks, and domain logic
web/src/shared/api/          persistent Relay and media clients
web/src/shared/config/       public runtime configuration
web/src/shared/i18n/         all application-owned UI copy
web/src/shared/lib/          protocol and browser utilities
web/src/shared/ui/           reusable visual primitives
web/tests/e2e/               Playwright user journeys
agent-control/               optional signed agent-start service
deploy/                      container and edge-routing examples
docs/                        operator documentation
```

Keep code feature-local until at least two features need the same stable behavior. `shared/` is not
a miscellaneous folder.

## Toolchain

- Use Node.js 24 for repository work. `agent-control` supports Node.js 22 or newer.
- Use npm and committed lockfiles. Do not replace npm with pnpm/yarn in this standalone repository.
- Use TypeScript strict mode, React 19, TanStack Router/Query, Biome, Vitest, and Playwright.
- Use `rg` for search and `apply_patch` for manual edits.
- Do not edit `web/src/app/routeTree.gen.ts`; the TanStack Router plugin generates it.
- Do not commit `node_modules`, `dist`, Playwright reports, screenshots, local runtime config, or
  credential files.

## Development Workflow

Before editing:

1. Read the relevant feature, its tests, and current runtime configuration flow.
2. Check `git status`; preserve unrelated user changes.
3. Confirm whether the operation belongs to browser UI, Relay protocol, or Agent Control.

During implementation:

- Prefer existing feature patterns and typed event structures over ad hoc JSON/string parsing.
- Keep effects idempotent and clean up WebSockets, timers, subscriptions, and object URLs.
- Include Relay URL and identity in cache/storage keys whenever data can differ across them.
- Do not catch an error only to present success. Surface a localized stable message and, when safe,
  a bounded server detail.
- Keep production source files below the enforced 1,000-line limit. Split by responsibility before
  reaching that limit; do not weaken the check.
- Add comments only for security boundaries, protocol subtleties, or non-obvious invariants.

After implementation, run the narrow test first and then all required gates listed below.

## Internationalization

English and Simplified Chinese are first-class supported locales.

- Every application-owned user-facing string must use `t()` from
  `web/src/shared/i18n/index.ts`. This includes visible text, `aria-label`, `title`, placeholder,
  toast, validation, error, empty, loading, and confirmation copy.
- Every message key must include both `en` and `zh-CN` values.
- Brand names, protocol terms, user content, channel names, repository content, and server-provided
  details remain untranslated.
- Use `getLocale()` with `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, and locale-aware sorting.
  Do not hand-build English time strings.
- `web/index.html` uses English as the no-JavaScript/default language. Startup code updates the
  document language from the browser's first preferred locale.
- Changes to user-facing flows require at least one explicit English assertion and one Chinese
  assertion when copy or layout differs.

Do not add a settings-only language switch unless the selected locale is persisted, applied
reactively, and tested across every route. Browser-language detection remains the current contract.

## Relay and Protocol Rules

- Runtime `config.json` is authoritative. WebSocket queries, NIP-98 HTTP requests, media, invites,
  Git, and deep links must all use the configured Relay rather than silently falling back to the
  page origin.
- Authenticate Relay WebSockets with NIP-42 and signed HTTP operations with NIP-98.
- Channel-scoped events use the protocol tags and membership rules defined by Buzz/NIP-29. Do not
  infer authorization from UI state.
- Private-channel data must never be cached under a key shared by identities or Relays.
- Treat events, profile URLs, Markdown, Git files, and Relay error bodies as untrusted input.
- Keep repository HTML execution opt-in and in an iframe sandbox without `allow-same-origin`.

## Secret and Privacy Rules

Never commit, log, place in a URL, or expose through public runtime configuration:

- Nostr `nsec` values or hexadecimal private keys
- Relay owner keys, API tokens, invite secrets, or database/object-store credentials
- model-provider keys, gateway credentials, or Agent environment files
- private hostnames, internal IP addresses, organization names, or operator home directories

Examples must use `buzz.example.com`, documentation address ranges such as `10.0.0.10`, and clear
`<placeholder>` values. An imported identity may be encrypted in IndexedDB, but raw private key
material must not be written to `localStorage` or sent to Agent Control.

## Required Checks

For Web changes:

```bash
cd web
npm ci
npm run typecheck
npm test
npm run check
npm run test:e2e
```

For Agent Control changes:

```bash
cd agent-control
npm ci
npm test
```

For deployment changes:

```bash
docker compose -f deploy/compose.yml config
```

Always finish with:

```bash
git diff --check
```

If a check cannot run, report exactly which check and why. Do not describe unrun tests as passing.

## Verification

Use [Required Checks](#required-checks) for the component being changed. For UI work, inspect the
actual surface at desktop and mobile widths. Use the project's existing demo only for presentation
and interaction checks; it does not exercise a real Relay or agent runtime.
Real collaboration changes also require the dedicated identities and cross-client checks in
[P0 Real Relay Acceptance](docs/p0-relay-acceptance.md). Never use a primary identity as test data.

### Build

```json
{"command": {"argv": ["npm", "run", "build"], "cwd": "web"}}
```

## Documentation and Commits

- Keep `README.md` and `README.zh-CN.md` behaviorally aligned.
- Update both Roadmap languages when priority or scope changes.
- Update deployment documents when paths, ports, health checks, or public configuration change.
- Use Conventional Commit subjects and sign commits with `git commit -s`.
- Never rewrite, reset, or discard changes that are not part of the current task.
