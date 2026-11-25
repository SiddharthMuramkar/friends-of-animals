// The settings version is part of each stored kind and deterministic object
// key. Change the version when geometry, encoder or approved assets change;
// old copies retain their original identity and retention.
export const STAMP_VARIANTS = [
  "gallery",
  "gallery_thumb",
  "social",
  "certificate_share",
] as const;
export type StampVariant = (typeof STAMP_VARIANTS)[number];

export const STAMP_SETTINGS = {
  gallery: {
    kind: "stamp_gallery_v1",
    maxEdge: 800,
    contentType: "image/webp",
    extension: "webp",
  },
  gallery_thumb: {
    kind: "stamp_gallery_thumb_v1",
    maxEdge: 480,
    contentType: "image/webp",
    extension: "webp",
  },
  social: {
    kind: "stamp_social_v1",
    maxEdge: 1600,
    contentType: "image/png",
    extension: "png",
  },
  certificate_share: {
    kind: "stamp_certificate_share_v1",
    maxEdge: 2200,
    contentType: "image/png",
    extension: "png",
  },
} as const satisfies Record<
  StampVariant,
  { kind: string; maxEdge: number; contentType: string; extension: string }
>;
export type StampedKind = (typeof STAMP_SETTINGS)[StampVariant]["kind"];
