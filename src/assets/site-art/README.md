# Site art: FOA's AI illustrations

These drawings fill the public site with life until commissioned illustrations arrive (planned for
about four months). They were made with AI image and video models, used through ElevenLabs:
`gpt-image-2.5-sunburst` for stills, and `bytedance-seedance-v2-mini` for the short clips that
become living illustrations. ADR 0003 records
why AI illustrations are allowed here and photos are not.

## Rules

- **Labelled.** A meaningful drawing has alt text that starts "AI illustration: " and shows the
  hand-lettered AI mark (`<Illustration>`, `<ArtFigure>`, `<ArtCover>`, a meaningful
  `<LivingIllustration>`). Decorative pieces are hidden from screen readers; one a sighted reader
  could take for a child's drawing still shows the mark (the home hero's dog). The footer says
  "Our decorative drawings are AI illustrations, not children's work. Every photo is real." and
  /credits lists every piece with how it was made.
- **Photos stay real.** Illustrations must look drawn. The home gallery can show individually
  labelled illustrations as activity prompts. Use professional editorial art for those prompts.
  The gallery shows children's Entries only with permission.
- **Content limits (gates).** No children, people, faces or hands. Only behaviour the site's own
  copy recommends: no feeding by hand, no milk, bread or sweets, no touching, chasing, cages, leashes
  or nose ropes, no distressed or injured animal. No text, numbers or logos. No named real place.
- **Checked.** Every piece here met the rubric's ship bar below (three AI judges; its real score is
  `review.mean` in `art.json`). Pieces that missed it were redrawn and judged again, or retired.
  `humanReviewer` stays `null` until a person at FOA has looked: never fill it in for them.
- **Replaceable by id.** Pages name illustrations by id (`SiteArtId`). To retire one, delete its
  entry from the manifest and rebuild; the tests then point at every place that still uses it.

## House style: "Kolam Sketchbook"

Warm brown-black hand-inked outlines with gentle line-weight variation, flat gouache fills with
subtle grain, rounded friendly shapes, kind expressions, soft light from the upper left; natural
animal colours with small accents of marigold yellow, leaf green, terracotta red and turquoise.
Confident professional editorial illustration for a published Indian children's picture book —
never a child's crayon drawing.

- **Cast:** the ten Neighbours of /awareness (fawn Indie dog with a white blaze and curled tail,
  orange-and-white street cat, house crow with a grey collar, common myna, house sparrow, rock
  pigeon, black kite, palm squirrel, zebu cow with a small bell, Asian koel).
  Story and month pieces add a greater adjutant stork and its chicks, a spotted owlet, a plain
  tiger butterfly and a ladybird.
  The model draws a chipmunk when asked for a palm squirrel close up: check the face (no stripes).
- **Spot art** comes with a transparent background and gets a white die-cut edge, so its ink line
  reads on the dark theme. **Covers** are full-bleed and sit in cards.
- **Living keyframes** are drawn on flat chroma green (`#00FF00`), with no green on the subject.

`prompt` in `art.json` is the subject part of each prompt. The shared parts were the style above,
the background line ("Background: fully transparent…" or the chroma green), and the gates as
"Constraints: …".

## Rubric

Each piece is scored 1–5 by three judges with different lenses (welfare and safeguarding,
art direction, product delight) on: meaning in its slot, style, craft, Indian authenticity,
composition at display size, legibility on light and dark, delight, and technical cleanliness
(edges, alpha, stray parts; for strips, steady frames). Gates: welfare, safety, AI artefacts, text,
logo. A welfare or safety gate failed by any one judge rejects a piece (the other lenses never
outvote the welfare judge); the artefact, text and logo gates reject it when two or more judges fail
them.

A piece ships when no gate rejects it and its overall mean is at least 4 ("good enough to ship" on
the scale); `review.mean` in `art.json` keeps its real score and `review.judges` the panel's size. The target is
higher (every criterion averaging at least 4 and an overall mean of at least 4.3), and a redraw
aims for it. Pieces shown side by side as a set (neighbour emblems, "try" swaps, rescue steps, a
row of step icons) ship only when every member does; otherwise the set's place keeps its old look.

## Making and changing art

Downloads and the build manifest live in `.art-staging/` (git-ignored).

```sh
pnpm art:build                # every manifest entry -> src/assets/site-art + art.json + ids
pnpm art:build living-cat     # just these ids
pnpm exec tsx scripts/site-art/preview.ts out.png <file.webp>...   # light/dark QA, every frame
pnpm exec tsx scripts/site-art/contact.ts out.png <img>... --cols 4 --bg "#171511"
pnpm exec tsx scripts/site-art/overlay.ts <img> out.png '<points json>'   # hotspot check
```

`scripts/site-art/build.ts` cuts sheet cells with a bleed margin (keeping only the parts centred in
the cell), clears the faint ghosts neighbouring cells leave behind, crops to the subject (so it
sits centred), adds the die-cut edge (trimming whiskers and fringes that reach past it; an
`openBottom` piece, such as an animal peeking over an edge, stays flush along its bottom), embeds
the IPTC `DigitalSourceType` `trainedAlgorithmicMedia` in XMP, and writes WebP. For a living
illustration it reads every video frame, skips frames where the animal runs out of the video's
frame, keys the green, matches the video's colours to the crisp start keyframe, picks frames at
even steps of motion (or the hand-picked `pick` list), crops all frames to one shared box (a
`ground` strip instead stands every frame on its bottom edge, for an animal sitting on a line)
and writes a horizontal strip (`frames` in `art.json`) at about twice its largest slot. `LivingIllustration` plays the strip with a scroll-driven `steps()`
animation and rests on the last frame, which is also what reduced-motion users see.

A redraw keeps its id, so pages need no change; the new piece is judged again before it ships. A
piece may also be changed by script after generation, without AI (the notice board's pinned prints
were painted over as blank sheets, so no made-up picture stands where children's work goes): its
`prompt` record says so, and it is judged again too.
`pnpm exec tsx scripts/site-art/crop.ts <in> <out.png> <left> <top> <width> <height> [scale]`
crops a detail for a closer look.
