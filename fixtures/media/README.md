# Media fixtures

Test images for the media processor (`src/server/ports/media.contract.ts`,
`src/server/ports/media-sharp.test.ts`) and the Files module's media job. Each
one carries the metadata a phone leaves in a photo, which the media pipeline
must strip: participants are often children, and a photo's GPS position is a
safeguarding leak.

`scripts/media-fixtures.ts` writes every file here except `upstream/`, and
checks that the metadata really is in them:

```sh
pnpm tsx scripts/media-fixtures.ts
```

| File          | What it is                                                                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gps.jpg`     | 2000 × 1500 JPEG of four flat colour quadrants. EXIF GPS (a public landmark: the Gateway of India, Mumbai), camera make and model, an XMP creator and an IPTC by-line and caption.                                                                                                                                   |
| `rotated.jpg` | The same quadrants stored as 600 × 400, with EXIF Orientation 6. It shows as a 400 × 600 portrait with red at the top right.                                                                                                                                                                                         |
| `iphone.heic` | `upstream/hyperframes-rotated-grid.heic` with its Exif item replaced: GPS, camera make and model, and Orientation 6. The image is a 1100 × 700 grid of six 512 × 512 HEVC tiles with an `irot` box, so it shows as 700 × 1100, the way an iPhone stores photos. Its EXIF Orientation must not turn it a second time. |
| `corrupt.jpg` | The first 4096 bytes of `gps.jpg`: the header reads, the pixels don't, as with an interrupted upload.                                                                                                                                                                                                                |

No fixture shows a person. The quadrant images are made by the script and are
released with this repository.

## Upstream

`upstream/hyperframes-rotated-grid.heic` is copied unchanged from
[heygen-com/hyperframes](https://github.com/heygen-com/hyperframes),
`packages/producer/tests/fixtures/heic/rotated-grid.heic` (at commit
`370f09d74ca61020ba51417e7fd375b8bb50ad28`; SHA-256
`d72e123529ad751d07d70f13a20b0ae7594e5b4894734d6b96c6141a75f032d9`). That
repository is licensed under the Apache License 2.0. Its test describes it as
a 1100 × 700 grid of six 512 × 512 tiles tagged with a 270° anticlockwise
rotation. We found no openly licensed iPhone photo with GPS data and no person
in it, and libheif-js has no HEVC encoder, so the script adds the metadata to
this file instead.
