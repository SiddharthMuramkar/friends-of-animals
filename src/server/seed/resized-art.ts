// The seeded illustrations' resized copies (#85 entry pictures, #129
// adoption photos), made with sharp once per machine rather than once per
// process: every test file that seeds a preview runs in its own process,
// and decoding and resizing the same pictures in each took a quarter of
// the seed's first run. Copies are kept in the system temp directory,
// keyed by the source's bytes and the kinds asked for; anything wrong with
// the cache (unwritable, unreadable, stale format) falls back to resizing.
//
// Loads under plain Node (seed): relative imports only.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DerivativeKind } from "../modules/files/domain/derivatives";
import type { MediaDerivative } from "../ports/media";
import { sharpMediaProcessor } from "../ports/media-sharp";

/** Bump when the stored format, or how copies are made, changes. */
const FORMAT = 1;

const DIR = join(tmpdir(), "foa-seed-resized-art");

type Stored = Omit<MediaDerivative, "bytes"> & { bytes: string };

const inProcess = new Map<string, Promise<MediaDerivative[]>>();

/** `source`'s copies at `kinds`, resized once per machine. */
export function resizedArt(
  source: URL,
  kinds: readonly DerivativeKind[]
): Promise<MediaDerivative[]> {
  const memo = `${source.href} ${kinds.join(",")}`;
  let made = inProcess.get(memo);
  if (!made) {
    made = load(source, kinds);
    inProcess.set(memo, made);
  }
  return made;
}

async function load(source: URL, kinds: readonly DerivativeKind[]) {
  const bytes = new Uint8Array(await readFile(source));
  const key = createHash("sha256")
    .update(`${FORMAT} ${kinds.join(",")} `)
    .update(bytes)
    .digest("hex");
  const file = join(DIR, `${key}.json`);
  const cached = await readCached(file);
  if (cached) return cached;
  const { derivatives } = await sharpMediaProcessor().processImage({
    bytes,
    kinds: [...kinds],
  });
  await writeCached(file, derivatives);
  return derivatives;
}

async function readCached(file: string) {
  try {
    const stored = JSON.parse(await readFile(file, "utf8")) as Stored[];
    return stored.map(({ bytes, ...rest }) => ({
      ...rest,
      bytes: new Uint8Array(Buffer.from(bytes, "base64")),
    }));
  } catch {
    return undefined;
  }
}

async function writeCached(file: string, derivatives: MediaDerivative[]) {
  const stored: Stored[] = derivatives.map(({ bytes, ...rest }) => ({
    ...rest,
    bytes: Buffer.from(bytes).toString("base64"),
  }));
  // Written aside and renamed, so a process reading at the same time sees
  // the whole file or none.
  const partial = `${file}.${process.pid}.${Date.now()}.partial`;
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(partial, JSON.stringify(stored));
    await rename(partial, file);
  } catch {
    // The copies are still returned; the next process resizes again.
  }
}
