/**
 * The welfare message for each sample competition (SPEC §6.3.1
 * `welfareMessageHtml`), keyed by slug, as plain paragraphs. Sample content:
 * shown on test sites only, beside the Sample tag. Every line follows
 * DIRECTION §5: no touching or feeding street animals, "Tell a grown-up".
 */
export const SAMPLE_WELFARE: Readonly<Record<string, readonly string[]>> = {
  "neighbours-on-my-street": [
    "The dog by the gate, the crow on the wire, the squirrel in the neem tree: they live on your street too. That makes them your neighbours.",
    "Good neighbours watch from a distance and let animals be. If one looks hurt or stuck, don't go near it. Tell a grown-up.",
  ],
  "a-bowl-of-water": [
    "In an Indian summer, birds and small animals can struggle to find water. A wide, shallow bowl of clean water in the shade, on your own balcony, terrace or garden, helps.",
    "Change the water every day and scrub the bowl every week, so mosquitoes can't breed in it.",
  ],
  "kinder-skies": [
    "Kite season is a joy, and birds share the same sky. Fly kites only with plain cotton thread.",
    "If you see a bird caught in a string, don't try to free it yourself. Tell a grown-up.",
  ],
};
