// Drizzle schema barrel. One file per module next to this one, re-exported
// here with one `export *` line each; drizzle.config.ts, the app's `db`
// client and the test harness all read the schema from this file.
//
// Never import "server-only" here or in any schema file: drizzle-kit loads
// the schema under plain Node, where that import throws.
export * from "./identity";
export * from "./mailbox";
export * from "./access";
export * from "./audit";
export * from "./second-factor";
export * from "./outbox";
export * from "./consent";
export * from "./files";
export * from "./media";
export * from "./offsite-copy";
export * from "./worker";
export * from "./competitions";
export * from "./settings";
