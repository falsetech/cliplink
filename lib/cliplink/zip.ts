/**
 * A minimal ZIP writer: store only, no compression, no ZIP64.
 *
 * Storing is the right trade for a transfer tool. Photos, video and archives
 * are already compressed, and deflating them would cost CPU for nothing. The
 * archive is a Blob that references each file's own Blob, so assembling it
 * copies nothing; only the CRC pass reads the bytes, one chunk at a time.
 */

export type ZipEntry = {
  /** `/`-separated path inside the archive, e.g. `photos/2024/a.jpg`. */
  name: string;
  data: Blob;
  lastModified?: number;
};

/** Classic ZIP offsets and sizes are 32-bit. */
export const ZIP_MAX_BYTES = 0xffff_ffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

async function crc32(blob: Blob) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    const bytes = chunk.value;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is what ZIP headers carry. */
function dosDateTime(ms: number) {
  const date = new Date(ms);
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Makes every name unique, the way a file manager would: `a (2).txt`. */
function uniqueNames(names: string[]) {
  const seen = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    const dot = name.lastIndexOf(".");
    const slash = name.lastIndexOf("/");
    const [stem, ext] =
      dot > slash + 1 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let n = 2; seen.has(candidate.toLowerCase()); n += 1) {
      candidate = `${stem} (${n})${ext}`;
    }
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Builds the archive. Throws if it would pass the 4 GiB classic ZIP limit. */
export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const names = uniqueNames(entries.map((entry) => entry.name));
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const [index, entry] of entries.entries()) {
    const name = encoder.encode(names[index]);
    const size = entry.data.size;
    if (offset + 30 + name.length + size > ZIP_MAX_BYTES) {
      throw new RangeError("The files are too large for a zip.");
    }
    const crc = await crc32(entry.data);
    const { time, date } = dosDateTime(entry.lastModified ?? Date.now());

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true); // version needed
    l.setUint16(6, 0x0800, true); // names are UTF-8
    l.setUint16(8, 0, true); // stored
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);

    const header = new Uint8Array(46 + name.length);
    const c = new DataView(header.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true); // version made by
    c.setUint16(6, 20, true); // version needed
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    header.set(name, 46);

    parts.push(local, entry.data);
    central.push(header);
    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, header) => sum + header.length, 0);
  if (offset + centralSize + 22 > ZIP_MAX_BYTES || entries.length > 0xffff) {
    throw new RangeError("The files are too large for a zip.");
  }
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
