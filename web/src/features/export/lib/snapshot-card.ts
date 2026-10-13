import { t } from "@/shared/i18n";
import {
  AGENT_SNAPSHOT_PNG_KEYWORD,
  type AgentSnapshot,
  MAX_AGENT_SNAPSHOT_JSON_BYTES,
  MAX_AGENT_SNAPSHOT_PNG_BYTES,
  snapshotFail,
} from "./agent-snapshot";
import { hasPngMagic, PngFormatError, readPngChunks } from "./snapshot-png";
import { injectPngTextChunk, placeholderPngWithText, utf8ToBase64 } from "./snapshot-png-encode";
import {
  MAX_TEAM_SNAPSHOT_JSON_BYTES,
  MAX_TEAM_SNAPSHOT_PNG_BYTES,
  TEAM_SNAPSHOT_PNG_KEYWORD,
  type TeamSnapshot,
} from "./team-snapshot";

/** Desktop caps the card's image body edge; the manifest keeps the full-size avatar. */
export const MAX_PNG_BODY_EDGE = 512;

export type SnapshotFileFormat = "json" | "png";

/** Desktop `encode_snapshot_json`: pretty-printed manifest. */
export function snapshotJson(snapshot: AgentSnapshot | TeamSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

function enforceCap(size: number, cap: number): void {
  if (size > cap) {
    snapshotFail(t("collab.export.snapshot.errorExportTooLarge", { limit: cap / (1024 * 1024) }));
  }
}

/** True for a PNG whose IHDR fits inside the body cap (desktop `png_within_body_cap`). */
export function isPngWithinBodyCap(bytes: Uint8Array): boolean {
  if (!hasPngMagic(bytes)) return false;
  try {
    const header = readPngChunks(bytes)[0];
    if (header?.type !== "IHDR") return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return (
      view.getUint32(header.dataStart) <= MAX_PNG_BODY_EDGE &&
      view.getUint32(header.dataStart + 4) <= MAX_PNG_BODY_EDGE
    );
  } catch (error) {
    if (error instanceof PngFormatError) return false;
    throw error;
  }
}

/**
 * `.agent.png`: the avatar (already a PNG within the body cap) carries the manifest chunk;
 * without one, desktop's 1×1 transparent placeholder does.
 */
export function encodeAgentSnapshotPng(
  snapshot: AgentSnapshot,
  avatarBody: Uint8Array | null,
): Uint8Array<ArrayBuffer> {
  const text = utf8ToBase64(snapshotJson(snapshot));
  let png: Uint8Array<ArrayBuffer> | null = null;
  if (avatarBody && isPngWithinBodyCap(avatarBody)) {
    try {
      png = injectPngTextChunk(avatarBody, AGENT_SNAPSHOT_PNG_KEYWORD, text);
    } catch (error) {
      if (!(error instanceof PngFormatError)) throw error;
    }
  }
  png ??= placeholderPngWithText(AGENT_SNAPSHOT_PNG_KEYWORD, text);
  enforceCap(png.length, MAX_AGENT_SNAPSHOT_PNG_BYTES);
  return png;
}

/** `.team.png`: teams have no avatar, so the body is always the placeholder. */
export function encodeTeamSnapshotPng(snapshot: TeamSnapshot): Uint8Array<ArrayBuffer> {
  const png = placeholderPngWithText(
    TEAM_SNAPSHOT_PNG_KEYWORD,
    utf8ToBase64(snapshotJson(snapshot)),
  );
  enforceCap(png.length, MAX_TEAM_SNAPSHOT_PNG_BYTES);
  return png;
}

export function encodeSnapshotJsonFile(snapshot: AgentSnapshot | TeamSnapshot): string {
  const body = `${snapshotJson(snapshot)}\n`;
  const cap = "members" in snapshot ? MAX_TEAM_SNAPSHOT_JSON_BYTES : MAX_AGENT_SNAPSHOT_JSON_BYTES;
  enforceCap(new TextEncoder().encode(body).length, cap);
  return body;
}
