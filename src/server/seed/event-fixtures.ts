// Stable synthetic IDs; safe to import under standalone Playwright Node.
export const SEED_EVENTS = {
  full: {
    id: "01938a00-0000-7000-8000-000000125001",
    slug: "seed-compassion-workshop",
    title: "Compassion workshop",
  },
  mobile: {
    id: "01938a00-0000-7000-8000-000000125002",
    slug: "seed-kindness-workshop",
    title: "Kindness workshop",
  },
  campaign: {
    id: "01938a00-0000-7000-8000-000000125003",
    slug: "seed-water-for-animals",
    title: "Water for animals campaign",
  },
  draft: {
    id: "01938a00-0000-7000-8000-000000125004",
    slug: "seed-draft-foa-event",
    title: "Volunteer picnic (draft)",
  },
  past: {
    id: "01938a00-0000-7000-8000-000000125005",
    slug: "seed-past-awareness-walk",
    title: "Animal welfare awareness walk",
  },
} as const;
