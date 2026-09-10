/**
 * A minimal ZIP writer — stored entries only, no compression.
 *
 * The spec export is a Markdown file plus a picture, and they have to arrive together or the
 * `![](images/…)` link in the Markdown points at nothing. Two separate downloads don't do
 * that: browsers ask before allowing the second one, and rename either of them on a
 * collision, which breaks the link. A ZIP is one file and one prompt.
 *
 * Deliberately no dependency: deflate would mean shipping a compressor to save a few
 * kilobytes on text, while the PNG that dominates the archive is already compressed.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index++) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** The clock format ZIP was born with: two-second resolution, years from 1980. */
function dosStamp(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export interface ZipEntry {
  /** Path inside the archive, e.g. "images/model.png". Forward slashes only. */
  name: string;
  /** Backed by a plain ArrayBuffer, which is what Blob accepts as a part. */
  data: Uint8Array<ArrayBuffer>;
}

export function zipStore(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const { time, day } = dosStamp(new Date());

  const body: BlobPart[] = [];
  const directory: BlobPart[] = [];
  let offset = 0;
  let directorySize = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // the version that introduced stored + directories
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored, not deflated
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size — the same, since nothing is compressed
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // no extra field
    body.push(local.buffer, name, entry.data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true); // where this entry's local header starts
    directory.push(central.buffer, name);

    offset += 30 + name.length + size;
    directorySize += 46 + name.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true); // where the central directory starts

  return new Blob([...body, ...directory, end.buffer], { type: "application/zip" });
}
