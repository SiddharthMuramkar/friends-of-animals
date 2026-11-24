// Drizzle schema barrel. One file per module next to this one, re-exported
// here with one `export *` line each; drizzle.config.ts, the app's `db`
// client and the test harness all read the schema from this file.
//
// Never import "server-only" here or in any schema file: drizzle-kit loads
// the schema under plain Node, where that import throws.
export * from "./entries";
export * from "./identity";
export * from "./mailbox";
export * from "./access";
export * from "./audit";
export * from "./outbox";
export * from "./ledger";
export * from "./institution-invitations";
export * from "./consent";
export * from "./consent-links";
export * from "./second-factor";
export * from "./cms";
export * from "./files";
export * from "./consent-forms";
export * from "./media";
export * from "./offsite-copy";
export * from "./worker";
export * from "./competitions";
export * from "./competition-terms";
export * from "./competition-transitions";
export * from "./judging";
export * from "./settings";
export * from "./safeguarding";
export * from "./contact";
export * from "./public-forms";
export * from "./institutions";
export * from "./notifications";
export * from "./registration";
export * from "./payments";
export * from "./guardians";
export * from "./payment-test-gateway";
export * from "./refunds";
export * from "./posts";
export * from "./breaches";
export * from "./announcements";
export * from "./contact";
export * from "./public-forms";
export * from "./privacy";
export * from "./directory";
