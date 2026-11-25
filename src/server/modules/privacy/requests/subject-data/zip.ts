// A store-only ZIP writer for subject data exports (#115b). Every entry is
// stored uncompressed: the uploads are already-compressed images and PDFs
// and the JSON is small, so a hundred lines here beat a new dependency.
// Names are UTF-8 (general purpose bit 11). No ZIP64: an export stays far
// below 4 GiB, and writing one that wouldn't fails loudly.
//
// Loads under plain Node: relative imports only.

import { crc32 } from "node:zlib";

export type ZipEntry = { name: string; bytes: Uint8Array };

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** Version 2.0: what a stored entry with a UTF-8 name needs. */
const VERSION = 20;
/** General purpose bit 11: the name is UTF-8. */
const UTF8_NAMES = 1 << 11;
const LIMIT = 0xffffffff;

/** MS-DOS date and time fields, in UTC (ZIP has no zone). */
function dosDateTime(at: Date): { date: number; time: number } {
  const year = Math.max(at.getUTCFullYear(), 1980);
  return {
    date:
      ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    time:
      (at.getUTCHours() << 11) |
      (at.getUTCMinutes() << 5) |
      Math.floor(at.getUTCSeconds() / 2),
  };
}

const utf8 = new TextEncoder();

/** One archive holding `entries`, in order, stored uncompressed. */
export function zipStore(
  entries: readonly ZipEntry[],
  options: { modifiedAt: Date }
): Uint8Array {
  const { date, time } = dosDateTime(options.modifiedAt);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    const size = entry.bytes.byteLength;
    if (size > LIMIT || offset > LIMIT) {
      throw new RangeError("An export this large needs ZIP64");
    }
    const crc = crc32(entry.bytes);

    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_FILE_HEADER, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, UTF8_NAMES, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.byteLength, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_DIRECTORY_HEADER, true);
    cv.setUint16(4, VERSION, true);
    cv.setUint16(6, VERSION, true);
    cv.setUint16(8, UTF8_NAMES, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.byteLength, true);
    // Extra length, comment length, disk number, attributes: all zero.
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, entry.bytes);
    centrals.push(central);
    offset += local.byteLength + size;
  }

  const directorySize = centrals.reduce(
    (sum, part) => sum + part.byteLength,
    0
  );
  if (entries.length > 0xffff || offset > LIMIT) {
    throw new RangeError("An export this large needs ZIP64");
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);

  const archive = new Uint8Array(offset + directorySize + end.byteLength);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    archive.set(part, at);
    at += part.byteLength;
  }
  return archive;
}
