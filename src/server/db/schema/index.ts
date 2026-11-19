// Drizzle schema barrel. Add one file per module next to this one (for
// example `./competitions.ts`) and re-export it here; drizzle.config.ts,
// the app's `db` client and the test harness all read the schema from this
// file. There are no tables yet: the first ones arrive with the first feature.
//
// Never import "server-only" here or in any schema file: drizzle-kit loads
// the schema under plain Node, where that import throws.
export {};
