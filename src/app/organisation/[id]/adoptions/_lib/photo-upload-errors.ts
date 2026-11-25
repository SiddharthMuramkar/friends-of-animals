// The refusals the photo upload form can show (#129). A plain module, so
// the server page can build their labels: a "use client" file's exports
// other than components reach the server only as client references.

export const PHOTO_UPLOAD_ERRORS = [
  "empty",
  "alt_required",
  "alt_too_long",
  "type_not_allowed",
  "too_large",
  "too_many_photos",
  "listing_closed",
  "directory_not_verified",
  "upload_failed",
  "forbidden",
  "unexpected",
] as const;

export type PhotoUploadError = (typeof PHOTO_UPLOAD_ERRORS)[number];
