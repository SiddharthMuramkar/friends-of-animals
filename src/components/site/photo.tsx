import Image from "next/image";

import { LcpPhoto } from "./lcp-photo";
import { PhotoFigure, type PhotoProps, photoImage } from "./photo-figure";

// next/image loading props (constants: the lint rule bars literals here).
// Every photo but the LCP one lazy-loads behind a blur.
const LAZY_IMAGE = { placeholder: "blur" } as const;

type Props = PhotoProps & {
  /**
   * Only for the one above-the-fold image on a page (the LCP image): loads it
   * eagerly at high fetch priority, with no blur placeholder (LcpPhoto). A
   * page with no other photo imports LcpPhoto instead, which leaves
   * next/image's client code off the page.
   */
  preload?: boolean;
};

/**
 * A credited site photo: next/image with a blur placeholder (none on the LCP
 * image), an optional tile frame, the real place in the caption and a short
 * credit for CC images.
 */
export function Photo({ preload = false, ...props }: Props) {
  if (preload) return <LcpPhoto {...props} />;
  return (
    <PhotoFigure
      {...props}
      image={<Image {...photoImage(props)} {...LAZY_IMAGE} />}
    />
  );
}
