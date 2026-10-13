// Minimal Ogg (RFC 3533) / Ogg Opus (RFC 7845) framing so the native-wire
// test peer can hand raw Opus packets to and from libopus via ffmpeg.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return crc >>> 0;
}

/** Split an Ogg byte stream into packets (all logical streams, in order). */
export function demuxOggPackets(data: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let pending: number[] = [];
  let offset = 0;
  while (offset + 27 <= data.length) {
    if (
      data[offset] !== 0x4f ||
      data[offset + 1] !== 0x67 ||
      data[offset + 2] !== 0x67 ||
      data[offset + 3] !== 0x53
    ) {
      throw new Error(`invalid Ogg capture pattern at ${offset}`);
    }
    const segments = data[offset + 26] ?? 0;
    const lacing = data.subarray(offset + 27, offset + 27 + segments);
    let cursor = offset + 27 + segments;
    for (const size of lacing) {
      for (let index = 0; index < size; index += 1) pending.push(data[cursor + index] ?? 0);
      cursor += size;
      if (size < 255) {
        packets.push(Uint8Array.from(pending));
        pending = [];
      }
    }
    offset = cursor;
  }
  return packets;
}

/** Audio packets of an Ogg Opus stream (drops OpusHead and OpusTags). */
export function opusPacketsFromOgg(data: Uint8Array): Uint8Array[] {
  return demuxOggPackets(data).slice(2);
}

/** Samples at 48 kHz carried by one Opus packet (RFC 6716 §3.1). */
export function opusPacketSamples(packet: Uint8Array): number {
  const toc = packet[0] ?? 0;
  const config = toc >> 3;
  let frameSamples: number;
  if (config < 12) frameSamples = [480, 960, 1920, 2880][config % 4] ?? 960;
  else if (config < 16) frameSamples = config % 2 === 0 ? 480 : 960;
  else frameSamples = [120, 240, 480, 960][config % 4] ?? 960;
  const code = toc & 0x03;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 1) & 0x3f : 2;
  return frameSamples * frames;
}

function page(
  packet: Uint8Array,
  granule: bigint,
  serial: number,
  sequence: number,
  headerType: number,
): Uint8Array {
  const lacing: number[] = [];
  let remaining = packet.length;
  while (remaining >= 255) {
    lacing.push(255);
    remaining -= 255;
  }
  lacing.push(remaining);
  const bytes = new Uint8Array(27 + lacing.length + packet.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4f, 0x67, 0x67, 0x53], 0);
  bytes[4] = 0;
  bytes[5] = headerType;
  view.setBigInt64(6, granule, true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  bytes[26] = lacing.length;
  bytes.set(lacing, 27);
  bytes.set(packet, 27 + lacing.length);
  view.setUint32(22, oggCrc(bytes), true);
  return bytes;
}

/** Wrap raw Opus packets into a decodable single-stream Ogg Opus file. */
export function oggFromOpusPackets(packets: Uint8Array[], channels = 2): Uint8Array {
  const serial = 0x42757a7a;
  const head = new Uint8Array(19);
  const headView = new DataView(head.buffer);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1;
  head[9] = channels;
  headView.setUint16(10, 312, true);
  headView.setUint32(12, 48_000, true);
  headView.setInt16(16, 0, true);
  head[18] = 0;
  const vendor = new TextEncoder().encode("buzz-live-test");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const tagsView = new DataView(tags.buffer);
  tags.set(new TextEncoder().encode("OpusTags"), 0);
  tagsView.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  tagsView.setUint32(12 + vendor.length, 0, true);

  const pages = [page(head, 0n, serial, 0, 0x02), page(tags, 0n, serial, 1, 0)];
  let granule = 0n;
  packets.forEach((packet, index) => {
    granule += BigInt(opusPacketSamples(packet));
    const last = index === packets.length - 1;
    pages.push(page(packet, granule, serial, index + 2, last ? 0x04 : 0));
  });
  const output = new Uint8Array(pages.reduce((total, item) => total + item.length, 0));
  let offset = 0;
  for (const item of pages) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
}
