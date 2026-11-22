---
Status: accepted
---

# Labelled AI illustrations, real photos

The public site may show AI-made Illustrations, each one labelled, while every
Photo stays a real, credited photograph. This answers the owner's ruling on
#8 ("at most, labelled and stylised illustrations") and open question 4.
Until now, "no AI images" was a developer default.

The site had only a few dozen photos. Half of the home page said "coming",
two of three story cards had no picture, and six of the twelve months had no
picture either. FOA wants the site to feel drawn and alive before its own
artwork and photos arrive, about four months from now. We kept photos and
drawings apart because they promise different things:

- **A Photo says "this is real".** Photos keep their registry
  (`src/lib/images`, `ai: z.literal(false)`), so an AI image can never be
  passed off as a photo.
- **An Illustration says "this is drawn".** Illustrations have their own
  registry (`src/lib/art`, `src/assets/site-art/art.json`) with full
  provenance: model, generation ids, prompt, date and rubric review.

## Rules

- **Labelling.**
  - Every Illustration that carries meaning has the AI mark beside it, and its
    alt text starts with "AI illustration:".
  - Decorative Illustrations are hidden from screen readers and have no mark,
    unless a sighted reader could take one for a child's drawing (the home
    hero's dog sits right under "Children's art…" and shows the mark).
  - The footer says that the drawings decorating the site are AI
    illustrations, not children's work, and that every photo is real.
  - /credits lists every Illustration.
  - Each source file carries the IPTC `trainedAlgorithmicMedia` digital
    source type in its XMP. The image optimizer re-encodes the copies most
    pages are served and drops it, so on the page the alt text and the AI mark
    are the label; living strips and the 404 page's faces are served as made
    and keep it.
- **What an Illustration may show.**
  - No children, people, faces or hands.
  - No Entry, and nothing that could pass for a child's drawing. The gallery
    frames stay empty until real, consented Entries exist (owner decision 1).
  - No real place, no baked-in text, and never the FOA logo or its tiles.
  - Only behaviour the site's own copy recommends, such as water bowls. Never
    feeding or handling street animals, and no distressed animal.
- **Review.** A rubric panel of three AI judges, each with its own lens,
  judges each Illustration before it ships. A welfare or safety failure from
  any one judge rejects it. The registry records that review with
  `humanReviewer: null` until FOA looks at it. The style guide and the rubric live in `src/assets/site-art/README.md`.
- **Replacement.** Each Illustration is referenced by id, so commissioned art
  replaces it by swapping the file and its registry entry, with no page
  changes.

## Consequences

- The site-images README now says "No AI photos" rather than "No AI images".
- A new kind of art needs its own folder in `ART_FOLDERS` and passes the
  registry schema: alt text or decorative, and provenance.
- Motion stays within the JavaScript budget. Living illustrations are frame
  strips driven by CSS scroll-driven animations, and they rest on a still
  frame wherever motion is reduced or unsupported.
