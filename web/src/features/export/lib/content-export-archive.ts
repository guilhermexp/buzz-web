import { strToU8, zipSync } from "fflate";
import type { BuzzChannel } from "@/features/chat/lib/chat-types";
import type { NostrEvent } from "@/shared/api/nostr-types";
import type { ExportRange } from "./content-export-model";

export const CONTENT_EXPORT_FORMAT = "buzz-web-content-export";
export const CONTENT_EXPORT_VERSION = 1;

export type ExportChannelSummary = Pick<BuzzChannel, "id" | "name" | "type" | "visibility">;

export type ExportedChannel = {
  channel: ExportChannelSummary;
  /** Scoped, signed events (see scopeChannelEvents) plus the canvas head when present. */
  events: NostrEvent[];
  markdown: string;
  /** True when the per-channel page bound stopped pagination before the relay ran out. */
  truncated: boolean;
};

export type ContentExportManifest = {
  format: typeof CONTENT_EXPORT_FORMAT;
  version: typeof CONTENT_EXPORT_VERSION;
  exportedAt: string;
  relayUrl: string;
  exporterPubkey: string;
  range: { since: string | null; until: string | null };
  channels: Array<
    ExportChannelSummary & { directory: string; eventCount: number; truncated: boolean }
  >;
};

/** Filesystem-safe directory name: `<slug>-<first 8 id chars>`. */
export function channelDirectoryName(channel: Pick<BuzzChannel, "id" | "name">): string {
  const slug = channel.name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const idPrefix = channel.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  return `${slug || "channel"}-${idPrefix}`;
}

function isoOrNull(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

export function buildContentArchive(input: {
  relayUrl: string;
  exporterPubkey: string;
  exportedAt: Date;
  range: ExportRange;
  channels: readonly ExportedChannel[];
}): { manifest: ContentExportManifest; zip: Uint8Array } {
  const files: Record<string, Uint8Array> = {};
  const manifest: ContentExportManifest = {
    format: CONTENT_EXPORT_FORMAT,
    version: CONTENT_EXPORT_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    relayUrl: input.relayUrl,
    exporterPubkey: input.exporterPubkey,
    range: { since: isoOrNull(input.range.since), until: isoOrNull(input.range.until) },
    channels: [],
  };
  for (const { channel, events, markdown, truncated } of input.channels) {
    const directory = `channels/${channelDirectoryName(channel)}`;
    files[`${directory}/events.json`] = strToU8(`${JSON.stringify(events, null, 2)}\n`);
    files[`${directory}/messages.md`] = strToU8(markdown);
    manifest.channels.push({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      visibility: channel.visibility,
      directory,
      eventCount: events.length,
      truncated,
    });
  }
  files["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, zip: zipSync(files, { level: 6 }) };
}
