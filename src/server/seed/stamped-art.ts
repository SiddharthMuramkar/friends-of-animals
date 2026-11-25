// Preview-only synthetic illustration cache, just like resized-art.ts. The
// actual approved stamp is rendered once for each exact safe display input
// and variant version, avoiding repeated Sharp work in every seed test.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  StampProcessor,
  StampedImage,
  StampImageInput,
} from "../ports/media";
import { stampProcessor } from "../ports/media-stamp";
import { STAMP_SETTINGS } from "../modules/stamping/domain/variants";
const directory = join(tmpdir(), "foa-seed-gallery-stamps-v1");
type Stored = Omit<StampedImage, "bytes"> & { bytes: string };
const memo = new Map<string, Promise<StampedImage>>();
async function load(input: StampImageInput, key: string) {
  const file = join(directory, `${key}.json`);
  try {
    const cached = JSON.parse(await readFile(file, "utf8")) as Stored;
    const settings = STAMP_SETTINGS[input.variant];
    if (
      cached.contentType === settings.contentType &&
      cached.width > 0 &&
      cached.height > 0 &&
      Math.max(cached.width, cached.height) <= settings.maxEdge
    ) {
      const bytes = new Uint8Array(Buffer.from(cached.bytes, "base64"));
      if (bytes.length > 0) return { ...cached, bytes };
    }
  } catch {
    /* Unavailable cache: render the exact current stamp. */
  }
  const output = await stampProcessor().stampImage(input);
  const temporary = `${file}.${process.pid}.${Date.now()}.partial`;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      temporary,
      JSON.stringify({
        ...output,
        bytes: Buffer.from(output.bytes).toString("base64"),
      })
    );
    await rename(temporary, file);
  } catch {
    /* The real output remains valid without a seed cache. */
  }
  return output;
}
export const seedStampProcessor: StampProcessor = {
  stampImage(input) {
    const key = createHash("sha256")
      .update(STAMP_SETTINGS[input.variant].kind)
      .update(input.bytes)
      .digest("hex");
    let result = memo.get(key);
    if (!result) {
      result = load(input, key);
      memo.set(key, result);
      result.catch(() => memo.delete(key));
    }
    return result;
  },
};
