// Reads a ZIP archive back the way an unzip tool does, for the export
// tests (#115b): from the end of central directory record back to each
// local header, checking every entry's CRC-32 against its bytes. It shares
// no code with ./zip.ts, so a writer that mislays an offset or a size
// fails here. Tests only: nothing in the app imports it.

import { crc32 } from "node:zlib";

export type ReadZipEntry = {
  name: string;
  /** General purpose bit flags from the central directory. */
  flags: number;
  /** 0 is stored (no compression). */
  method: number;
  crc32: number;
  /** MS-DOS date and time fields, as stored. */
  dosDate: number;
  dosTime: number;
  bytes: Uint8Array;
};

export type ReadZip = {
  entries: ReadZipEntry[];
  names: string[];
  /** The entry's bytes as UTF-8 text. Throws if there is no such entry. */
  text(name: string): string;
  /** Every entry's name and bytes as UTF-8 text, joined: for leak scans. */
  allText(): string;
};

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

const utf8 = new TextDecoder("utf-8", { fatal: true });

export function readZip(archive: Uint8Array): ReadZip {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength
  );
  // No archive comment, so the record is the last 22 bytes.
  const end = archive.byteLength - 22;
  if (end < 0 || view.getUint32(end, true) !== END_OF_CENTRAL_DIRECTORY) {
    throw new Error("No end of central directory record");
  }
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (directoryOffset + directorySize !== end) {
    throw new Error("The central directory does not end where the record is");
  }

  const entries: ReadZipEntry[] = [];
  let at = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error(`No central directory header for entry ${i}`);
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const dosTime = view.getUint16(at + 12, true);
    const dosDate = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = utf8.decode(archive.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
      throw new Error(`No local header for ${name}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localName = utf8.decode(
      archive.subarray(localOffset + 30, localOffset + 30 + localNameLength)
    );
    if (localName !== name) {
      throw new Error(`Local header names ${localName}, directory ${name}`);
    }
    if (
      view.getUint32(localOffset + 14, true) !== crc ||
      view.getUint32(localOffset + 18, true) !== compressedSize ||
      view.getUint32(localOffset + 22, true) !== size
    ) {
      throw new Error(`Local header and directory disagree about ${name}`);
    }
    if (method !== 0 || compressedSize !== size) {
      throw new Error(`${name} is not stored uncompressed`);
    }
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const bytes = archive.slice(start, start + size);
    if (bytes.byteLength !== size || crc32(bytes) !== crc) {
      throw new Error(`${name} fails its CRC-32 check`);
    }
    entries.push({ name, flags, method, crc32: crc, dosDate, dosTime, bytes });
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    entries,
    names: entries.map((entry) => entry.name),
    text(name) {
      const entry = byName.get(name);
      if (!entry) throw new Error(`No entry named ${name}`);
      return utf8.decode(entry.bytes);
    },
    allText() {
      return entries
        .map(
          (entry) => `${entry.name}\n${new TextDecoder().decode(entry.bytes)}`
        )
        .join("\n");
    },
  };
}
