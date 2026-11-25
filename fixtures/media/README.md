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

## Videos (#86)

`scripts/media-fixtures.ts` can't make videos: the two clips were made once
with Debian trixie's ffmpeg 7.1.5 (the worker-media image's), from ffmpeg's
own test patterns, and committed. `src/server/ports/media-ffmpeg.media.test.ts`
checks that the metadata really is in `gps.mov` before it checks the strip.

| File        | What it is                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gps.mov`   | 1 s QuickTime, H.264 and AAC, stored 320 × 240 with a display matrix that turns it a quarter, so it shows as 240 × 320. An ISO 6709 location (the Gateway of India), camera make and model, and a creation time. |
| `clip.webm` | 1 s WebM, VP8 and Opus, 320 × 240, with a title tag.                                                                                                                                                             |

```sh
ffmpeg -f lavfi -i "testsrc2=size=320x240:rate=30:duration=1" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=1" \
  -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -c:a aac -b:a 64k -shortest \
  -metadata creation_time=2026-11-01T10:00:00Z -metadata make=FixturePhone \
  -metadata model="Fixture 1" -metadata location="+18.9220+072.8347/" \
  -metadata com.apple.quicktime.location.ISO6709="+18.9220+072.8347+010.000/" \
  -metadata com.apple.quicktime.make=FixturePhone \
  -metadata com.apple.quicktime.model="Fixture 1" \
  -movflags use_metadata_tags -f mov plain.mov
ffmpeg -display_rotation:v:0 90 -i plain.mov -c copy -map_metadata 0 \
  -movflags use_metadata_tags -f mov gps.mov
ffmpeg -f lavfi -i "testsrc2=size=320x240:rate=30:duration=1" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=1" \
  -c:v libvpx -b:v 200k -c:a libopus -shortest -metadata title=fixture -f webm clip.webm
```

The seeded video entry's copy and poster (`src/assets/seed/entry-video.mp4`,
`entry-video-poster.jpg`) were made the same way from
`src/assets/site-art/scenes/scene-street-neighbours.webp`: 4 s of the still,
640 × 360, H.264 and silent AAC, every piece of metadata dropped.
