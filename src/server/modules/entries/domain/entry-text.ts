// The words that come with an entry: a title, a short description and an
// optional statement about the work. The schema's check constraints, the
// use cases' input rules and the form's counters all use these limits.
//
// Pure: no I/O, no "server-only".

/** The most characters each field holds. */
export const ENTRY_TEXT_LIMITS = {
  title: 120,
  description: 500,
  statement: 1500,
} as const;
