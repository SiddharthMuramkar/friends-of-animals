// Imports India Post's pin-code directory into `pincode_location` (#128):
// `pnpm directory:import-pincodes <file.csv> [--target <host>/<database>]`.
// The file is the "All India Pincode Directory" CSV from data.gov.in; FOA
// confirms its licence and runs the import (HR-59). Running it again with
// the same file changes nothing but the rows' time, and a newer file
// replaces the centres it names.
//
// It connects through DIRECT_URL, like the migration, and says which host
// and database first. A database on another machine needs `--target`
// naming the same one, so a stray DIRECT_URL can't be written by mistake.

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { migrationEnvSchema, parseEnv } from "../src/env.schema";
import { directTls, migrationTarget } from "../src/server/db/database-url";
import * as schema from "../src/server/db/schema";
import { importPincodeCsv } from "../src/server/modules/directory/pincodes";
import { errorSummaryForLogs } from "../src/server/errors";
import { systemClock } from "../src/server/ports/clock";
import { importTarget, parseImportPincodesArgs } from "./import-pincodes-args";
import { loadEnvFiles } from "./load-env";

const args = parseImportPincodesArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(args.error);
  process.exit(2);
}

let csv: string;
try {
  csv = await readFile(args.file, "utf8");
} catch (error) {
  console.error(`Can't read ${args.file}: ${errorSummaryForLogs(error)}`);
  process.exit(2);
}

loadEnvFiles();

let url: string;
try {
  ({ url } = migrationTarget(parseEnv(migrationEnvSchema, process.env)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const target = importTarget(url, args.target);
if (!target.ok) {
  console.error(target.error);
  process.exit(2);
}
console.log(`Target: ${target.host}/${target.database}`);

const client = postgres(url, {
  ...directTls(url),
  max: 1,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => {},
});

try {
  const db = drizzle({ client, schema });
  const result = await db.transaction((tx) =>
    importPincodeCsv({ db: tx, clock: systemClock }, csv)
  );
  await client.end();
  if (!result.ok) {
    console.error(
      `Refused: the file has no ${result.column} column; nothing was written.`
    );
    process.exit(1);
  }
  const { rows, saved, skipped } = result;
  console.log(
    `Read ${rows} post offices; saved ${saved} pin codes. Skipped: ` +
      `${skipped.bad_pin} with a bad pin code, ` +
      `${skipped.no_coordinates} without coordinates, ` +
      `${skipped.outside_india} outside India.`
  );
} catch (error) {
  console.error(`Import failed: ${errorSummaryForLogs(error)}`);
  await client.end({ timeout: 5 });
  process.exit(1);
}
