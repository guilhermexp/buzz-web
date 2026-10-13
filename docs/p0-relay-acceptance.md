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
| `playwright.live-collab.config.ts` | Canvas, forums, reminders, Pulse, exports | — |
| `playwright.live-agents.config.ts` | Managed agent lifecycle, usage, memory, catalogs | Agent Control (`BUZZ_LIVE_AGENT_CONTROL_URL`) with an `agents` grant and a model endpoint |
| `playwright.live-projects.config.ts` | Publish, issues, PRs, review, merge, protected refs | `git` on the test host |
| `playwright.live-workflows.config.ts` | Workflow authoring, runs and approvals | Companion Relay with approval gates |
| `playwright.live-voice.config.ts` | Huddle audio, mute, leave, revocation; voice notes | Companion Relay, `ffmpeg` and `libopus` for the native-wire peer |
| `playwright.live-voice-controls.config.ts` | Denied permission, deafen, device loss, reconnect, Firefox | Companion Relay |
| `playwright.live-push.config.ts` | Web Push with all app tabs closed, deep links, mutes | Relay with VAPID configured, Firefox, Internet access to the push service |
| `playwright.live-remote.config.ts` | Remote terminal, files, MCP, revocation | Agent Control with `terminal`/`files`/`mcp` grants and a writable grants file (`BUZZ_LIVE_REMOTE_GRANTS_FILE`) |

Feature suites write screenshots and evidence logs to the Playwright output directory or the
ignored `.tmp/` tree (each spec names its override variable at the top). Review them before sharing:
they show test content and public keys, never private keys.

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
