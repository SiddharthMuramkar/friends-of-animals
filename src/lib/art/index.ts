import "server-only";

import type { StaticImageData } from "next/image";

import { type Art, type SiteArtId, artFor } from "./art";
import { ART_FILES } from "./generated";

export type { Art, SiteArtId } from "./art";
export { SITE_ART_IDS, art } from "./art";

/** A file's URL and pixel size, without its blur placeholder. */
export type PlainImage = Pick<StaticImageData, "src" | "width" | "height">;

export type SiteArt = {
  id: SiteArtId;
  /**
   * Hashed, immutable /_next/static/media file with its width, height and
   * blur placeholder: for an image that shows the blur.
   */
  src: StaticImageData;
  /**
   * The same file without the blur placeholder. next/image is a client
   * component, so the page's RSC payload carries whatever `src` it gets:
   * pass this one unless the image uses placeholder="blur".
   */
  plain: PlainImage;
  entry: Art;
};

/** An AI illustration with its registry entry. Unknown ids are a type error. */
export function siteArt(id: SiteArtId): SiteArt {
  const src = ART_FILES[id];
  return {
    id,
    src,
    plain: { src: src.src, width: src.width, height: src.height },
    entry: artFor(id),
  };
}
