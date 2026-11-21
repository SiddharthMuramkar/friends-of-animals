// Fixed scope ids for seeded grants (#59), so links and Seam 2 journeys can
// name them. There are no institution, competition or organisation rows
// yet; the tickets that add those tables (#70, #73) seed rows with these
// ids. Loads under plain Node: no imports.

export const SEED_SCOPES = {
  institution: {
    id: "01938a00-0000-7000-8000-000000001001",
    name: "Seed Public School",
  },
  competition: {
    id: "01938a00-0000-7000-8000-000000002001",
    name: "Seed Drawing Competition",
  },
  organisation: {
    id: "01938a00-0000-7000-8000-000000003001",
    name: "Seed Partner Organisation",
  },
} as const;
