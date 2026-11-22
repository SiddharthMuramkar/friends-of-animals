import { getImageProps } from "next/image";

import { PhotoFigure, type PhotoProps, photoImage } from "./photo-figure";

// next/image loading props (constants: the lint rule bars literals here).
// The LCP image loads eagerly at high priority: the docs prefer that to
// `preload`, and React still adds the <link rel="preload"> for an eager
// image. It gets no blur, which would paint after the photo and become the
// LCP entry (#37).
const LCP_IMAGE = {
  loading: "eager",
  fetchPriority: "high",
  placeholder: "empty",
} as const;

/**
 * The one above-the-fold photo on a page (its LCP image): a credited site
 * photo that loads eagerly at high fetch priority, with no blur. With no
 * blur to clear, next/image's client component would only hydrate the
 * <img>, so this renders the same <img> from the server alone
 * (getImageProps). A page whose only photo this is loads none of
 * next/image's client code, about 5.7 kB gzipped (#55: /contact's 170 kB
 * budget). Photo with `preload` renders this too.
 */
export function LcpPhoto(props: PhotoProps) {
  const {
    props: { alt, ...img },
  } = getImageProps({ ...photoImage(props), ...LCP_IMAGE });
  return (
    <PhotoFigure
      {...props}
      // oxlint-disable-next-line nextjs/no-img-element -- next/image's own <img>, from getImageProps
      image={<img alt={alt} data-nimg="1" {...img} />}
    />
  );
}
