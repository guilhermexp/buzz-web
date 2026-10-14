import { t } from "@/shared/i18n";

type SupportedImageMime = "image/gif" | "image/jpeg" | "image/png" | "image/webp";

interface PreparedUpload {
  bytes: ArrayBuffer;
  mimeType: string;
}

const MAX_IMAGE_PIXELS = 25_000_000;
const UNSUPPORTED_MEDIA_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "heic",
  "heif",
  "m4a",
  "m4v",
  "mov",
  "mp3",
  "mp4",
  "mpeg",
  "mpg",
  "ogg",
  "ogv",
  "tif",
  "tiff",
  "wav",
  "webm",
]);
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_ALLOWED_ANCILLARY = new Set([
  "cHRM",
  "gAMA",
  "sBIT",
  "sRGB",
  "bKGD",
  "hIST",
  "tRNS",
  "sPLT",
  "acTL",
  "fcTL",
  "fdAT",
]);
const WEBP_ALLOWED_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
const WEBP_METADATA_FLAGS = 0x20 | 0x08 | 0x04;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.byteLength < prefix.byteLength) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

function matchesAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (bytes.byteLength - offset < value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function readU16(bytes: Uint8Array, offset: number, littleEndian = false): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new Error("truncated integer");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, littleEndian);
}

function readU32(bytes: Uint8Array, offset: number, littleEndian = false): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new Error("truncated integer");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, littleEndian);
}

function uint32LittleEndian(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function detectImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (matchesAscii(bytes, 0, "GIF87a") || matchesAscii(bytes, 0, "GIF89a")) {
    return "image/gif";
  }
  if (matchesAscii(bytes, 0, "RIFF") && matchesAscii(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  return null;
}

function pngHasChunk(bytes: Uint8Array, target: string): boolean {
  if (!startsWith(bytes, PNG_SIGNATURE)) return false;
  let offset = PNG_SIGNATURE.byteLength;
  while (offset + 12 <= bytes.byteLength) {
    const length = readU32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) return false;
    const kind = ascii(bytes, offset + 4);
    if (kind === target) return true;
    offset = end;
    if (kind === "IEND") return false;
  }
  return false;
}

function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (!matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WEBP")) return false;
  const inputEnd = readU32(bytes, 4, true) + 8;
  if (inputEnd < 12 || inputEnd > bytes.byteLength) return false;
  let offset = 12;
  while (offset + 8 <= inputEnd) {
    const kind = ascii(bytes, offset);
    const length = readU32(bytes, offset + 4, true);
    const end = offset + 8 + length + (length & 1);
    if (end > inputEnd) return false;
    if (kind === "ANIM" || kind === "ANMF") return true;
    offset = end;
  }
  return false;
}

function exifOrientation(bytes: Uint8Array): number | null {
  let tiffStart = 0;
  if (matchesAscii(bytes, 0, "Exif") && bytes[4] === 0 && bytes[5] === 0) tiffStart = 6;
  if (bytes.byteLength - tiffStart < 8) return null;
  const littleEndian = matchesAscii(bytes, tiffStart, "II");
  if (!littleEndian && !matchesAscii(bytes, tiffStart, "MM")) return null;
  try {
    if (readU16(bytes, tiffStart + 2, littleEndian) !== 42) return null;
    const ifdStart = tiffStart + readU32(bytes, tiffStart + 4, littleEndian);
    const entryCount = readU16(bytes, ifdStart, littleEndian);
    for (let index = 0; index < entryCount; index += 1) {
      const entry = ifdStart + 2 + index * 12;
      if (
        readU16(bytes, entry, littleEndian) === 0x0112 &&
        readU16(bytes, entry + 2, littleEndian) === 3 &&
        readU32(bytes, entry + 4, littleEndian) === 1
      ) {
        return readU16(bytes, entry + 8, littleEndian);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function scrubPng(bytes: Uint8Array, preserveAnimation: boolean): Uint8Array {
  if (!startsWith(bytes, PNG_SIGNATURE)) throw new Error("invalid PNG");
  const parts: Uint8Array[] = [PNG_SIGNATURE];
  let offset = PNG_SIGNATURE.byteLength;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) throw new Error("truncated PNG");
    const payloadLength = readU32(bytes, offset);
    const chunkLength = payloadLength + 12;
    if (chunkLength > bytes.byteLength - offset) throw new Error("invalid PNG chunk");
    const typeOffset = offset + 4;
    const kind = ascii(bytes, typeOffset);
    const payload = bytes.subarray(offset + 8, offset + 8 + payloadLength);
    if (preserveAnimation && kind === "iCCP") throw new Error("animated PNG uses ICC");
    if (preserveAnimation && kind === "eXIf") {
      const orientation = exifOrientation(payload);
      if (orientation !== null && orientation >= 2 && orientation <= 8) {
        throw new Error("animated PNG uses EXIF orientation");
      }
    }
    const ancillary = (bytes[typeOffset] & 0x20) !== 0;
    if (!ancillary || PNG_ALLOWED_ANCILLARY.has(kind)) {
      parts.push(bytes.subarray(offset, offset + chunkLength));
    }
    offset += chunkLength;
    if (kind === "IEND") return concatBytes(parts);
  }
  throw new Error("PNG is missing IEND");
}

function shouldKeepJpegSegment(
  marker: number,
  bytes: Uint8Array,
  payloadStart: number,
  payloadEnd: number,
): boolean {
  const length = payloadEnd - payloadStart;
  if (marker === 0xe0) {
    if (length < 14 || !matchesAscii(bytes, payloadStart, "JFIF\0")) return false;
    const width = bytes[payloadStart + 12];
    const height = bytes[payloadStart + 13];
    return length === 14 + 3 * width * height;
  }
  if (marker === 0xee) return length === 12 && matchesAscii(bytes, payloadStart, "Adobe");
  if ((marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe) {
    return false;
  }
  return true;
}

function scrubJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("invalid JPEG");
  const parts = [bytes.subarray(0, 2)];
  let offset = 2;
  let inScan = false;
  while (offset < bytes.byteLength) {
    if (inScan && bytes[offset] !== 0xff) {
      const marker = bytes.indexOf(0xff, offset);
      const end = marker === -1 ? bytes.byteLength : marker;
      parts.push(bytes.subarray(offset, end));
      offset = end;
      continue;
    }
    if (bytes[offset] !== 0xff) throw new Error("invalid JPEG marker");
    const markerStart = offset;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) throw new Error("truncated JPEG marker");
    const marker = bytes[offset];
    offset += 1;
    if (inScan && marker === 0x00) {
      parts.push(bytes.subarray(markerStart, offset));
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.subarray(markerStart, offset));
      continue;
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(markerStart, offset));
      return concatBytes(parts);
    }
    if (marker === 0xd8 || bytes.byteLength - offset < 2) throw new Error("invalid JPEG segment");
    const segmentLength = readU16(bytes, offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.byteLength) {
      throw new Error("invalid JPEG segment length");
    }
    if (shouldKeepJpegSegment(marker, bytes, offset + 2, segmentEnd)) {
      parts.push(bytes.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;
    inScan = marker === 0xda;
  }
  throw new Error("JPEG is missing EOI");
}

function appendWebpChunk(parts: Uint8Array[], kind: string, payload: Uint8Array): void {
  const header = new Uint8Array(8);
  for (let index = 0; index < 4; index += 1) header[index] = kind.charCodeAt(index);
  new DataView(header.buffer).setUint32(4, payload.byteLength, true);
  parts.push(header, payload);
  if (payload.byteLength & 1) parts.push(new Uint8Array(1));
}

function scrubWebpFrame(payload: Uint8Array): Uint8Array {
  if (payload.byteLength < 16) throw new Error("invalid WebP frame");
  const parts = [payload.subarray(0, 16)];
  let offset = 16;
  let sawAlpha = false;
  let sawImage = false;
  while (offset < payload.byteLength) {
    if (payload.byteLength - offset < 8) throw new Error("truncated WebP frame");
    const kind = ascii(payload, offset);
    const length = readU32(payload, offset + 4, true);
    const start = offset + 8;
    const end = start + length + (length & 1);
    if (end > payload.byteLength) throw new Error("invalid WebP frame chunk");
    const chunk = payload.subarray(start, start + length);
    if (kind === "ALPH") {
      if (sawAlpha || sawImage) throw new Error("invalid WebP frame layout");
      appendWebpChunk(parts, kind, chunk);
      sawAlpha = true;
    } else if (kind === "VP8 ") {
      if (sawImage) throw new Error("invalid WebP frame layout");
      appendWebpChunk(parts, kind, chunk);
      sawImage = true;
    } else if (kind === "VP8L") {
      if (sawAlpha || sawImage) throw new Error("invalid WebP frame layout");
      appendWebpChunk(parts, kind, chunk);
      sawImage = true;
    }
    offset = end;
  }
  if (!sawImage) throw new Error("WebP frame is missing image data");
  return concatBytes(parts);
}

function scrubWebp(bytes: Uint8Array, preserveAnimation: boolean): Uint8Array {
  if (!matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WEBP")) {
    throw new Error("invalid WebP");
  }
  const inputEnd = readU32(bytes, 4, true) + 8;
  if (inputEnd < 12 || inputEnd > bytes.byteLength) throw new Error("invalid WebP length");
  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset < inputEnd) {
    if (inputEnd - offset < 8) throw new Error("truncated WebP chunk");
    const kind = ascii(bytes, offset);
    const length = readU32(bytes, offset + 4, true);
    const payloadStart = offset + 8;
    const end = payloadStart + length + (length & 1);
    if (end > inputEnd) throw new Error("invalid WebP chunk");
    const payload = bytes.subarray(payloadStart, payloadStart + length);
    if (preserveAnimation && kind === "ICCP") throw new Error("animated WebP uses ICC");
    if (preserveAnimation && kind === "EXIF") {
      const orientation = exifOrientation(payload);
      if (orientation !== null && orientation >= 2 && orientation <= 8) {
        throw new Error("animated WebP uses EXIF orientation");
      }
    }
    if (WEBP_ALLOWED_CHUNKS.has(kind)) {
      if (kind === "VP8X") {
        if (!payload.byteLength) throw new Error("invalid VP8X chunk");
        const clean = new Uint8Array(payload);
        clean[0] &= ~WEBP_METADATA_FLAGS;
        appendWebpChunk(chunks, kind, clean);
      } else if (kind === "ANMF") {
        appendWebpChunk(chunks, kind, scrubWebpFrame(payload));
      } else {
        appendWebpChunk(chunks, kind, payload);
      }
    }
    offset = end;
  }
  const body = concatBytes(chunks);
  return concatBytes([
    new TextEncoder().encode("RIFF"),
    uint32LittleEndian(body.byteLength + 4),
    new TextEncoder().encode("WEBP"),
    body,
  ]);
}

function gifSubBlocksEnd(bytes: Uint8Array, start: number): number {
  let offset = start;
  while (offset < bytes.byteLength) {
    const length = bytes[offset];
    offset += 1;
    if (length === 0) return offset;
    offset += length;
    if (offset > bytes.byteLength) throw new Error("truncated GIF block");
  }
  throw new Error("GIF block is missing terminator");
}

function scrubGif(bytes: Uint8Array): Uint8Array {
  if (
    bytes.byteLength < 13 ||
    (!matchesAscii(bytes, 0, "GIF87a") && !matchesAscii(bytes, 0, "GIF89a"))
  ) {
    throw new Error("invalid GIF");
  }
  let offset = 13;
  if (bytes[10] & 0x80) {
    offset += 3 << ((bytes[10] & 0x07) + 1);
    if (offset > bytes.byteLength) throw new Error("truncated GIF color table");
  }
  const parts: Array<Uint8Array | null> = [bytes.subarray(0, offset)];
  const pendingGraphicControls: number[] = [];
  while (offset < bytes.byteLength) {
    if (bytes[offset] === 0x2c) {
      const start = offset;
      if (bytes.byteLength - offset < 10) throw new Error("truncated GIF image");
      const packed = bytes[offset + 9];
      offset += 10;
      if (packed & 0x80) offset += 3 << ((packed & 0x07) + 1);
      if (offset >= bytes.byteLength) throw new Error("missing GIF image data");
      offset = gifSubBlocksEnd(bytes, offset + 1);
      parts.push(bytes.subarray(start, offset));
      pendingGraphicControls.length = 0;
      continue;
    }
    if (bytes[offset] === 0x21) {
      const start = offset;
      if (bytes.byteLength - offset < 2) throw new Error("truncated GIF extension");
      const label = bytes[offset + 1];
      offset += 2;
      if (label === 0xf9) {
        if (bytes.byteLength - offset < 6 || bytes[offset] !== 4 || bytes[offset + 5] !== 0) {
          throw new Error("invalid GIF graphic control");
        }
        offset += 6;
        parts.push(bytes.subarray(start, offset));
        pendingGraphicControls.push(parts.length - 1);
      } else if (label === 0xff) {
        if (bytes.byteLength - offset < 12 || bytes[offset] !== 11) {
          throw new Error("invalid GIF application extension");
        }
        const loop =
          matchesAscii(bytes, offset + 1, "NETSCAPE2.0") ||
          matchesAscii(bytes, offset + 1, "ANIMEXTS1.0");
        const dataStart = offset + 12;
        offset = gifSubBlocksEnd(bytes, dataStart);
        if (loop) {
          if (
            bytes.byteLength - dataStart < 5 ||
            bytes[dataStart] !== 3 ||
            bytes[dataStart + 1] !== 1
          ) {
            throw new Error("invalid GIF loop extension");
          }
          parts.push(bytes.subarray(start, dataStart + 4), new Uint8Array(1));
        }
      } else {
        offset = gifSubBlocksEnd(bytes, offset);
        if (label === 0x01) {
          for (const index of pendingGraphicControls) parts[index] = null;
          pendingGraphicControls.length = 0;
        }
      }
      continue;
    }
    if (bytes[offset] === 0x3b) {
      parts.push(bytes.subarray(offset, offset + 1));
      return concatBytes(parts.filter((part): part is Uint8Array => part !== null));
    }
    throw new Error("invalid GIF block");
  }
  throw new Error("GIF is missing trailer");
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "default",
      imageOrientation: "from-image",
    });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("image encode failed"))),
      mimeType,
      0.95,
    );
  });
}

async function sanitizeStaticImage(bytes: Uint8Array, mimeType: SupportedImageMime) {
  const decoded = await decodeImage(new Blob([toArrayBuffer(bytes)], { type: mimeType }));
  try {
    if (
      decoded.width <= 0 ||
      decoded.height <= 0 ||
      decoded.width * decoded.height > MAX_IMAGE_PIXELS
    ) {
      throw new Error("image dimensions exceed policy");
    }
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(decoded.source, 0, 0);
    const encoded = await canvasBlob(canvas, mimeType);
    const output = new Uint8Array(await encoded.arrayBuffer());
    const outputType = detectImageMime(output);
    if (!outputType || outputType === "image/gif") throw new Error("unsupported canvas output");
    const sanitized =
      outputType === "image/jpeg"
        ? scrubJpeg(output)
        : outputType === "image/png"
          ? scrubPng(output, false)
          : scrubWebp(output, false);
    return { bytes: toArrayBuffer(sanitized), mimeType: outputType };
  } finally {
    decoded.close();
  }
}

const VOICE_NOTE_FILENAME = /^voice-note-\d+\.wav$/;
const WAV_ALLOWED_CHUNKS = new Set(["fmt ", "data", "fact"]);

/**
 * Desktop-compatible voice notes are recorder-generated mono WAV files. Accept them only
 * with a canonical RIFF/WAVE structure free of metadata chunks (LIST/INFO, id3, bext…),
 * so the bytes can be uploaded unmodified and keep their recorded sha256.
 */
export function isCleanVoiceNoteWav(name: string, bytes: Uint8Array): boolean {
  if (!VOICE_NOTE_FILENAME.test(name)) return false;
  if (!matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WAVE")) return false;
  if (readU32(bytes, 4, true) + 8 !== bytes.byteLength) return false;
  let offset = 12;
  let hasFormat = false;
  let hasData = false;
  while (offset + 8 <= bytes.byteLength) {
    const kind = ascii(bytes, offset);
    const size = readU32(bytes, offset + 4, true);
    if (!WAV_ALLOWED_CHUNKS.has(kind)) return false;
    if (kind === "fmt ") hasFormat = true;
    if (kind === "data") hasData = true;
    offset += 8 + size + (size % 2);
  }
  return hasFormat && hasData && offset === bytes.byteLength;
}

export async function prepareAttachmentUpload(file: File): Promise<PreparedUpload> {
  const original = await file.arrayBuffer();
  const bytes = new Uint8Array(original);
  const imageMime = detectImageMime(bytes);
  if (!imageMime) {
    const declaredType = file.type.trim().toLocaleLowerCase();
    if ((!declaredType || declaredType === "audio/wav") && isCleanVoiceNoteWav(file.name, bytes)) {
      return { bytes: original, mimeType: "audio/wav" };
    }
    const filenameParts = file.name.split(".");
    const extension = filenameParts[filenameParts.length - 1]?.toLocaleLowerCase() ?? "";
    if (
      declaredType.startsWith("image/") ||
      declaredType.startsWith("audio/") ||
      declaredType.startsWith("video/") ||
      UNSUPPORTED_MEDIA_EXTENSIONS.has(extension)
    ) {
      throw new Error(t("error.attachmentMediaUnsupported"));
    }
    return { bytes: original, mimeType: declaredType || "application/octet-stream" };
  }
  try {
    if (imageMime === "image/gif") {
      return { bytes: toArrayBuffer(scrubGif(bytes)), mimeType: imageMime };
    }
    if (imageMime === "image/png" && pngHasChunk(bytes, "acTL")) {
      return { bytes: toArrayBuffer(scrubPng(bytes, true)), mimeType: imageMime };
    }
    if (imageMime === "image/webp" && isAnimatedWebp(bytes)) {
      return { bytes: toArrayBuffer(scrubWebp(bytes, true)), mimeType: imageMime };
    }
    return await sanitizeStaticImage(bytes, imageMime);
  } catch {
    throw new Error(t("error.attachmentImagePrepare"));
  }
}
