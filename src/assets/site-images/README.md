# Site images

Photo masters for the public site, one folder per theme (`pages`, `neighbours`, `seasons`, `stories`).
Every file has an entry in `credits.json` (validated by `src/lib/images/credits.ts`; the tests fail if a file
and an entry do not match both ways). `focal.json` holds each subject's position for `object-position`.
Use them through `siteImage(id)` in `src/lib/images` or the `<Photo>` component; never import a file directly.

The picks, crops and licence checks come from the issue #14 imagery research
(`manifest-pages.json`, `manifest-animals.json`). Masters were made by
`/root/.cache/foa-issue14/tools/make-masters.mjs` (sharp + exifr, kept outside the repo):

- the original is downloaded from the recorded source, checked against the Commons SHA-1, and its SHA-256 is
  stored as `originalSha256`;
- mandatory crops are applied (fractions of the original, listed in the script);
- long edge at most 2400 px, sRGB JPEG at quality 80 (lower only to stay under 1 MB);
- all metadata (EXIF, GPS, ICC, XMP, IPTC) is stripped, and the script fails if exifr finds any.

To add a photo: add it to the script's pick list, run `node make-masters.mjs <repo>`, open the master and
reject any identifiable child, distress, legible plate or name, or watermark, then add its id to
`SITE_IMAGE_IDS` and the registry. No identifiable person goes in Git. No AI images.

CC BY-SA masters that were cropped are adaptations and carry the same licence; say so in `modifications`.
