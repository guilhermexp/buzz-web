/**
 * Send-time data the composer derives from its editor state, beyond the Markdown body.
 * `mentionPubkeys` are exact keys bound by the mention picker or unambiguous member names;
 * `emojiTags` are NIP-30 `["emoji", shortcode, url]` tags for custom emoji used in the body.
 */
export type ComposerSendExtras = {
  mentionPubkeys: string[];
  emojiTags: string[][];
};
