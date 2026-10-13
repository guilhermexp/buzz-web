/** Minimal PNG chunk walker for desktop snapshot cards (`buzz_agent_snapshot` / `buzz_team_snapshot` tEXt). */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TEXT_CHUNK_TYPES: ReadonlySet<string> = new Set(["tEXt", "zTXt", "iTXt"]);
const MAX_AVATAR_INLINE_BYTES = 2 * 1024 * 1024;

export class PngFormatError extends Error {}

export function hasPngMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 && PNG_SIGNATURE.slice(0, 4).every((value, index) => bytes[index] === value)
  );
}

export type PngChunk = { type: string; start: number; dataStart: number; length: number };

export function readPngChunks(bytes: Uint8Array): PngChunk[] {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new PngFormatError("signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    if (dataStart + length + 4 > bytes.length) throw new PngFormatError("truncated");
    chunks.push({ type, start: offset, dataStart, length });
    offset = dataStart + length + 4;
    if (type === "IEND") return chunks;
  }
  throw new PngFormatError("truncated");
}

/** Latin-1 text of the first tEXt chunk with this keyword, or null. */
export function readPngTextChunk(bytes: Uint8Array, keyword: string): string | null {
  for (const chunk of readPngChunks(bytes)) {
    if (chunk.type !== "tEXt") continue;
    const data = bytes.subarray(chunk.dataStart, chunk.dataStart + chunk.length);
    const separator = data.indexOf(0);
    if (separator < 0) continue;
    if (String.fromCharCode(...data.subarray(0, separator)) !== keyword) continue;
    let text = "";
    for (const byte of data.subarray(separator + 1)) text += String.fromCharCode(byte);
    return text;
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/**
 * Desktop adopts a card's PNG body as the avatar when the manifest carries no inline avatar,
 * except for the 1×1 no-avatar placeholder and bodies over the 2 MiB inline budget. Text
 * chunks (the manifest itself) are dropped so the avatar never re-carries the snapshot.
 */
export function pngBodyAvatarDataUrl(bytes: Uint8Array): string | null {
  const chunks = readPngChunks(bytes);
  const header = chunks[0];
  if (header?.type !== "IHDR" || header.length < 8) throw new PngFormatError("header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(header.dataStart) === 1 && view.getUint32(header.dataStart + 4) === 1) {
    return null;
  }
  const kept = chunks.filter((chunk) => !TEXT_CHUNK_TYPES.has(chunk.type));
  const size = 8 + kept.reduce((total, chunk) => total + chunk.length + 12, 0);
  if (size > MAX_AVATAR_INLINE_BYTES) return null;
  const clean = new Uint8Array(size);
  clean.set(PNG_SIGNATURE, 0);
  let offset = 8;
  for (const chunk of kept) {
    clean.set(bytes.subarray(chunk.start, chunk.dataStart + chunk.length + 4), offset);
    offset += chunk.length + 12;
  }
  return `data:image/png;base64,${toBase64(clean)}`;
}

/** Strict standard-alphabet base64 → UTF-8 text (desktop uses base64 STANDARD with padding). */
export function decodeBase64Utf8(text: string): string {
  const trimmed = text.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(trimmed)) {
    throw new PngFormatError("base64");
  }
  const binary = atob(trimmed);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
