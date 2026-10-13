# P0 Real Relay Acceptance

[English](p0-relay-acceptance.md) | [简体中文](p0-relay-acceptance.zh-CN.md)

P0 is implemented in the Web client, but it is not release-accepted until the workflows below
pass against an authorized real Relay. Demo-mode E2E tests remain useful regression coverage; they
do not satisfy this gate.

## Safety Boundary

Use two dedicated test identities that are already authorized community members:

- The admin identity must have owner or admin permission and must not be an operator's primary
  identity.
- The member identity must be a normal, distinct test member.
- Inject both `nsec` values from a local secret manager or CI secret store. Never put literal
  values in shell history, a checked-in file, URL, test report, screenshot, or trace.

The Live test disables screenshots, traces, videos, retries, and parallel workers. It creates one
uniquely named private channel with the `web-p0-` prefix, performs real Relay writes inside that
channel, removes the test member, and archives the channel during cleanup. A failed run can leave a
prefixed test channel behind; inspect it and archive it through the normal Web or Desktop control.
Do not clean up by editing Relay storage directly.

## Automated Run

Make the dedicated identities available as pre-existing environment variables through the chosen
secret manager, then run:

```bash
cd web
BUZZ_LIVE_BASE_URL=https://buzz.example.com/app/ \
BUZZ_LIVE_ADMIN_NSEC="$TEST_ADMIN_NSEC" \
BUZZ_LIVE_MEMBER_NSEC="$TEST_MEMBER_NSEC" \
npm run test:e2e:live-p0
```

The suite verifies:

- NIP-42 connectivity for both authorized identities.
- Owner/admin channel creation and private-channel visibility before membership, after addition,
  and after removal.
- Guest, admin, and member role changes plus confirmed member removal.
- Relay-backed favorite and mute state in an independent browser context.
- A Relay/identity/channel-scoped draft after a reload.
- Real-time channel unread appearance, clearing on open, and persisted read state after reload.
- Message send, reaction, thread reply, edit, delete, and preservation of thread links (a deleted
  message keeps its replies but no longer offers reactions).
- Archive cleanup through the same authorized UI operation used by normal clients.

## Feature Live Suites

The parity features have their own real-Relay suites. All use the same dedicated identities
(`BUZZ_LIVE_ADMIN_NSEC`, `BUZZ_LIVE_MEMBER_NSEC`), `BUZZ_LIVE_BASE_URL` for the Web build under test
and `BUZZ_LIVE_RELAY_URL` for direct protocol checks. Run each with
`npx playwright test --config=<config>` from `web/`.

| Config | Covers | Extra requirements |
| --- | --- | --- |
| `playwright.live-uishell.config.ts` | Community switching and isolation across two Relays | A second isolated Relay (`BUZZ_LIVE_RELAY_B_URL`, `BUZZ_LIVE_COMMUNITY_B_NAME`), `BUZZ_LIVE_SECOND_ADMIN_NSEC` with admin rights there, and the community preset in `config.json` |
| `playwright.live-composer.config.ts` | Formatting, mentions, emoji, attachments, drafts | — |
| `playwright.live-gif.config.ts` | Relay-proxied KLIPY GIF search: provider-failure mapping (en/zh-CN, nothing sent) and the search → share → send → render success path | Relay advertising `buzz-gif`; see [GIF search prerequisite](#gif-search-prerequisite) |
| `playwright.live-collab.config.ts` | Canvas, forums, reminders, Pulse, exports | — |
| `playwright.live-agents.config.ts` | Managed agent lifecycle, usage, memory, catalogs | Agent Control (`BUZZ_LIVE_AGENT_CONTROL_URL`) with an `agents` grant and a model endpoint |
| `playwright.live-projects.config.ts` | Publish, issues, PRs, review, merge, protected refs | `git` on the test host |
| `playwright.live-workflows.config.ts` | Workflow authoring, runs and approvals | Companion Relay with approval gates |
| `playwright.live-voice.config.ts` | Huddle audio, mute, leave, revocation; voice notes | Companion Relay, `ffmpeg` and `libopus` for the native-wire peer |
| `playwright.live-voice-controls.config.ts` | Denied permission, deafen, device loss, reconnect, Firefox | Companion Relay |
| `playwright.live-push.config.ts` | Web Push with all app tabs closed, deep links, mutes | Relay with VAPID configured, Firefox, Internet access to the push service |
| `playwright.live-push-click.config.ts` | Pointer click on the displayed notification: opens the exact event with app tabs closed, reuses an open tab, refuses channels removed after display | Same as `live-push`, plus an X display (`xvfb-run`), `xdotool` and ImageMagick `import`; Firefox runs headed with its own alert windows |
| `playwright.live-remote.config.ts` | Remote terminal, files, MCP, revocation | Agent Control with `terminal`/`files`/`mcp` grants and a writable grants file (`BUZZ_LIVE_REMOTE_GRANTS_FILE`) |

Feature suites write screenshots and evidence logs to the Playwright output directory or the
ignored `.tmp/` tree (each spec names its override variable at the top). Review them before sharing:
they show test content and public keys, never private keys.

### GIF search prerequisite

GIF search is proxied by the Relay (Buzz Relay `docs/gif-search.md`). The Web picker searches only
when the Relay's NIP-11 advertises `buzz-gif`, which it does only when the Relay process has
`BUZZ_KLIPY_API_KEY`. The success path needs real provider results, so it stays unproven until an
operator supplies a key; it is never waived or mocked.

Prerequisites:

1. An operator-approved KLIPY API test key, issued to the Relay operator through KLIPY's developer
   program. Do not borrow a production key or a tester's personal account.
2. Outbound HTTPS from the Relay host to `api.klipy.com` (port 443). Browsers load the selected
   media directly from KLIPY's CDN (`*.klipy.com`), which the Web CSP allows through `img-src https:`.
3. The key exists only in the Relay's environment. It rides in the upstream request path
   (`https://api.klipy.com/api/v1/<key>/gifs/...`), so never put it in a URL you share, shell
   history, tickets, logs, Web `config.json`, or browser storage. The Relay disables redirects and
   never returns provider bodies to clients.

Secret-safe injection (the key is read without echo and never appears in history or process lists):

```bash
umask 077
read -rs KLIPY_KEY && printf 'BUZZ_KLIPY_API_KEY=%s\n' "$KLIPY_KEY" > <relay-secrets-dir>/klipy.env
unset KLIPY_KEY
chmod 600 <relay-secrets-dir>/klipy.env
```

Load that file into the Relay process environment (systemd `EnvironmentFile=`, Compose
`env_file:`, or the launcher's `source`) and restart the Relay process, for example
`systemctl restart <relay-unit>`; the variable is read only at startup. The companion task launcher
(`.tmp/runtime/relay.sh` in the Relay worktree) loads `.tmp/runtime/secrets/klipy.env` for relays A
and B only; stop and start those relay processes after creating the file. Confirm the capability
without revealing the key:

```bash
curl -s -H 'Accept: application/nostr+json' https://buzz.example.com/info \
  | jq '{buzz_gif: (.supported_extensions | index("buzz-gif") != null), gif}'
```

Expect `"buzz_gif": true` and `{"provider": "klipy", "search": "/gifs/search", "share": "/gifs/share"}`.
Then run the success path:

```bash
cd web
BUZZ_LIVE_BASE_URL=https://buzz.example.com/app/ \
BUZZ_LIVE_RELAY_URL=wss://buzz.example.com \
BUZZ_LIVE_ADMIN_NSEC="$TEST_ADMIN_NSEC" \
BUZZ_LIVE_MEMBER_NSEC="$TEST_MEMBER_NSEC" \
BUZZ_LIVE_GIF_EXPECT_RESULTS=1 \
npx playwright test --config=playwright.live-gif.config.ts --grep "selects a KLIPY"
```

It searches, selects a result (the Relay must answer the share report with `204`), sends it, and
asserts that the message body carries a `*.klipy.com` URL with no `imeta` tag or upload and that the
second browser renders it. Unless NIP-11 advertises `buzz-gif` and
`BUZZ_LIVE_GIF_EXPECT_RESULTS=1` is set, the test is skipped with a reason that starts
`operator prerequisite missing: an operator-approved KLIPY test key (BUZZ_KLIPY_API_KEY)`. A
skip is not a pass.

The provider-failure test runs against a Relay that is deliberately configured with an obviously
invalid placeholder value, such as `BUZZ_KLIPY_API_KEY=invalid-test-key-not-a-credential`, with
`BUZZ_LIVE_GIF_EXPECT_ERROR_STATUS=502`. In the 2026-10-13 run, KLIPY answered that placeholder
with `404`. The Relay mapped this to `502 GIF provider rejected the search request`, and Web showed
the localized provider-failure message without sending or uploading anything. To remove the key,
delete `klipy.env` and restart the Relay. NIP-11 then stops advertising `buzz-gif`, and the picker
explains that GIF search is not available.

## Manual Cross-Client Gate

After the automated run passes, verify these behaviors between Web and the current Buzz Desktop
release using the same dedicated identities:

1. Favorite, mute, archive, and restored-channel state converge in both directions.
2. A message read in either client clears the channel and Inbox unread state in the other after
   reconnection.
3. A private channel is absent before membership, appears after membership, and disappears after
   removal.
4. Relay permission rejection leaves no successful-looking message, role, archive, or profile
   state in Web.
5. Identity backup, forget, restore, and switching complete without raw private material appearing
   in browser storage or downloaded diagnostics.

Record the date, Web commit, Desktop version, public Relay address, two test public keys, and result.
Never record either private key or a reusable invite code.
