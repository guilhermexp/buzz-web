import { zlibSync } from "fflate";
import { readPngChunks } from "./snapshot-png";

/**
 * Writes snapshot cards the way desktop `encode_chunk_payload_png` does: the manifest JSON,
 * base64-encoded, in a tEXt chunk placed directly after IHDR (before IDAT, where desktop's
 * `png` decoder stops reading metadata), on either the avatar PNG or a 1×1 transparent RGBA
 * placeholder.
 */

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_CHUNK_TYPES: ReadonlySet<string> = new Set(["tEXt", "zTXt", "iTXt"]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) chunk[4 + index] = type.charCodeAt(index);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** tEXt payload: Latin-1 keyword, NUL, Latin-1 text (base64 is plain ASCII). */
function textChunk(keyword: string, text: string): Uint8Array {
  const data = new Uint8Array(keyword.length + 1 + text.length);
  for (let index = 0; index < keyword.length; index += 1) data[index] = keyword.charCodeAt(index);
  for (let index = 0; index < text.length; index += 1) {
    data[keyword.length + 1 + index] = text.charCodeAt(index);
  }
  return pngChunk("tEXt", data);
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** Desktop `make_png_with_text`: 1×1 RGBA8, one transparent pixel, manifest chunk after IHDR. */
export function placeholderPngWithText(keyword: string, text: string): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  header.set([8, 6, 0, 0, 0], 8);
  return concat([
    SIGNATURE,
    pngChunk("IHDR", header),
    textChunk(keyword, text),
    pngChunk("IDAT", zlibSync(new Uint8Array([0, 0, 0, 0, 0]))),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/**
 * Put the manifest chunk right after IHDR of an existing PNG, dropping the source's own text
 * chunks so a stale or foreign snapshot payload can never shadow the new one.
 */
export function injectPngTextChunk(
  png: Uint8Array,
  keyword: string,
  text: string,
): Uint8Array<ArrayBuffer> {
  const chunks = readPngChunks(png);
  const parts: Uint8Array[] = [SIGNATURE];
  for (const chunk of chunks) {
    if (TEXT_CHUNK_TYPES.has(chunk.type)) continue;
    parts.push(png.subarray(chunk.start, chunk.dataStart + chunk.length + 4));
    if (chunk.type === "IHDR") parts.push(textChunk(keyword, text));
  }
  return concat(parts);
}
