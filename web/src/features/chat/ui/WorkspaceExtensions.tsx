// Extension slots owned by feature folders. Each slot renders nothing when
// its features have nothing to show, so the chat shell stays feature-agnostic.

/** Controls added to the selected channel's header (e.g. Canvas, Huddle). */
export function ChannelHeaderExtras() {
  return null;
}

/** Surface above the selected channel's timeline (e.g. an active Huddle). */
export function ChannelSurfaceExtras() {
  return null;
}
