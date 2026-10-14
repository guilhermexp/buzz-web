# Channel collaboration and personal productivity

Canvas, forums, reminders, Pulse and exports in Buzz Web. All of them use the configured Relay's
public WebSocket contract (NIP-42 authenticated) and wire formats that Buzz Desktop also reads.
The Relay enforces authorization: the browser never decides who may read or write.

## Canvas (kind 40100)

- Header button **Canvas** opens a resizable side panel: rendered Markdown, **Edit canvas**,
  history and restore.
- Writes carry `["h", channel]` and `["expected-revision", <head id> | "none"]`, with
  `created_at = max(now, head.created_at + 1)`. The Relay applies compare-and-swap and rejects stale
  writes with `conflict: …`.
- On a conflict the draft is kept. The panel shows the newer head and offers **Merge changes**
  (line-based three-way merge with conflict markers), **Overwrite with my draft** (a new CAS write
  on top of the new head) or **Discard my draft**.
- After each save the client checks whether its write was superseded by a concurrent one.
- History pages with `until` + `before_id`. **Restore** publishes the old content as a new head,
  using the current head as the expected revision.
- Non-members of a private channel get nothing: the Relay closes the REQ with `restricted:` and
  rejects writes.
- As on Desktop, only channel owners and admins can create, edit or restore a canvas. So can the
  NIP-OA-verified owner of an agent that owns the channel. Everyone else sees a read-only canvas
  with an explanation. The Relay itself accepts writes from any member, so this rule is enforced
  only by the client.

## Forums (kinds 45001, 45003, 40003, 5, 9005)

- Forum channels show a topic list in place of the timeline:
  - sorting by **Latest activity** or **Newest**;
  - reply counts and last activity;
  - per-topic unread state.
- Unread state uses the shared read-state context `thread:<postId>`, so the Inbox and forums agree.
- The title is stored as a leading `# Title` heading in the post content, which Desktop renders.
- Replies use NIP-10 tags:
  - a direct reply: `["e", root, "", "reply"]`;
  - a nested reply: a `root` tag and a `reply` tag.
- Authors edit their own events (40003) and delete them (kind 5).
- Channel owners and admins delete other people's events with kind 9005. The Relay rejects kind 5
  from anyone but the author.
- Inbox **Show in chat** on a forum item opens the topic and highlights the reply (`requestForumFocus`).

## Reminders (NIP-ER kind 30300)

- To create one, use **Remind me later** in a message's actions menu. It offers Desktop's presets
  or a custom time, plus an optional note.
- The Inbox **Reminders** filter lists Due, Upcoming and Completed reminders, with **Snooze**,
  **Complete**, **Cancel** and **Open message**.
- Content is NIP-44 encrypted to the author: `{target:{eventId,channelId,preview,authorPubkey},
  status, note?}` (Desktop's shape).
- Tags:
  - `d`: 128-bit random;
  - `not_before`: set while pending;
  - `alt`.
- Done and cancelled reminders drop `not_before` and get an `expiration` 30–90 days ahead.
- The Relay serves kind 30300 to its author only. Other identities' REQs are closed as
  `restricted`.
- The client keeps `{kinds:[30300], authors:[me]}` open without `since`, and the Relay re-publishes
  a reminder when it falls due.
- Each due reminder is announced once across reloads and tabs. A watermark per Relay and pubkey,
  serialized with `navigator.locks`, guarantees this.
- The announcement is a toast. A system notification is shown only when permission was already
  granted.
- Due reminders count toward the Inbox badge (`useDueReminderCount`).
- Web push does not wake the client for reminders, because the Relay's push kinds exclude 30300.

## Pulse (kinds 1, 7, 5, 3)

- The **Pulse** tool has these tabs: Everyone, Following, Liked, Agents, Mine and Search.
- It supports publishing notes and NIP-10 replies.
- The composer has @mention autocomplete. Mentions are written as `@Label` in the content plus a
  `p` tag, as on Desktop. Media is uploaded to the Relay and attached as `imeta` tags.
- Likes are kind 7 `+` events. Unliking publishes a kind 5 with `k=7`.
- Following updates the kind 3 contact list. The latest list is read again before every write, and
  every other tag is preserved.
- New notes from others appear behind a "new notes" pill.
- Selecting an author opens an in-Pulse profile view, and a note opens its thread.
- The Relay's full-text index excludes kind 1, so search filters the notes already loaded.

## Exports

- **Settings → Export** builds a ZIP (fflate) of the channels you select from those you can read.
  An optional date range limits it. The ZIP contains:
  - `manifest.json` (`buzz-web-content-export` v1);
  - per channel, `events.json` with the original signed events, which can be verified;
  - per channel, a readable `messages.md`.
- The archive includes:
  - stream messages, system events, edits, deletions and reactions;
  - forum events;
  - the canvas head.
- It never includes:
  - keys or vault data;
  - self-encrypted state (30078 and 30300);
  - unselected channels.
- Identity backup stays separate in **Settings → Identity**.
- Agent and team snapshots use Desktop's `buzz-agent-snapshot` v1 and `buzz-team-snapshot` v1
  formats (`features/export/lib`).
  - Export offers a PNG card (the default, as on Desktop: a `tEXt` chunk placed before `IDAT`) or
    JSON. Import accepts either format, and the Agents view embeds the import and export buttons.
  - `acpCommand` is carried over only when it is portable. Locked cards and memory entries are not
    imported.

## Verification

Live acceptance runs with real identities against a Relay:

```sh
BUZZ_LIVE_BASE_URL=http://127.0.0.1:<port>/ BUZZ_LIVE_RELAY_URL=ws://127.0.0.1:<relay> \
BUZZ_LIVE_ADMIN_NSEC=… BUZZ_LIVE_MEMBER_NSEC=… \
  npx playwright test --config=playwright.live-collab.config.ts
```

The suite runs `tests/e2e/live-collab-{canvas,forums,reminders,pulse,export}.spec.ts`. The unit
tests sit next to the code in `src/features/{canvas,forums,reminders,pulse,export}`.
