// Purges a dropped preview's files (`pnpm files:purge-preview --database
// <name>`): every object under that preview's prefix (`pr-<n>/` or
// `br-<hash>/`) in the non-production bucket. The preview sweeper's hook
// (docker/scripts/preview-dropped.d/50-purge-files.sh) runs it in the
// worker image after each DROP DATABASE, with the non-production R2
// variables. It refuses any name that isn't a preview database's, and any
// run under APP_ENV=production. See ./purge-preview-files-cli.ts.

import { systemClock } from "../src/server/ports/clock";
import { r2Storage } from "../src/server/ports/storage-r2";
import { loadEnvFiles } from "./load-env";
import { runPurgePreviewFiles } from "./purge-preview-files-cli";

loadEnvFiles();

process.exitCode = await runPurgePreviewFiles({
  argv: process.argv.slice(2),
  env: process.env,
  openStorage: (credentials) => r2Storage(credentials, systemClock),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
