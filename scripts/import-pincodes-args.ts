// The arguments of `pnpm directory:import-pincodes` (#128) and the database
// it may write to, kept apart from the script so they can be tested without
// a database. Same rule as the super-admin bootstrap: a local database as
// it is, any other only when --target names the same host and database.

import { parseArgs } from "node:util";

import { hostInDoubt, notLocal } from "../src/server/seed/target";

export const IMPORT_PINCODES_USAGE =
  "Usage: pnpm directory:import-pincodes <india-post-pincodes.csv> [--target <host>/<database>]";

export type ImportPincodesArgs =
  | { ok: true; file: string; target?: string }
  | { ok: false; error: string };

export function parseImportPincodesArgs(
  argv: readonly string[]
): ImportPincodesArgs {
  // `pnpm <script> -- file.csv` passes the separator on.
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let parsed: { values: { target?: string }; positionals: string[] };
  try {
    parsed = parseArgs({
      args,
      options: { target: { type: "string" } },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${reason}\n${IMPORT_PINCODES_USAGE}` };
  }
  const [file, ...extra] = parsed.positionals;
  if (!file?.trim() || extra.length > 0) {
    return {
      ok: false,
      error: `Name one CSV file to import.\n${IMPORT_PINCODES_USAGE}`,
    };
  }
  const target = parsed.values.target?.trim();
  return { ok: true, file, ...(target ? { target } : {}) };
}

export type ImportTarget =
  | { ok: true; host: string; database: string }
  | { ok: false; error: string };

/**
 * The host and database `url` writes to, if the import may. Messages name
 * the host and database, never the password or the URL's query.
 */
export function importTarget(
  url: string,
  confirmed: string | undefined
): ImportTarget {
  const doubt = hostInDoubt(url);
  if (doubt) return { ok: false, error: doubt };
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const named = `${host}/${database}`;
  if (confirmed === undefined) {
    const refused = notLocal(url, "an import without --target");
    return refused
      ? {
          ok: false,
          error: `${refused} To import into that database on purpose, pass --target ${named}.`,
        }
      : { ok: true, host, database };
  }
  const [confirmedHost = "", ...rest] = confirmed.split("/");
  if (`${confirmedHost.toLowerCase()}/${rest.join("/")}` !== named) {
    return {
      ok: false,
      error: `--target ${confirmed} doesn't match DIRECT_URL, which names ${named}.`,
    };
  }
  return { ok: true, host, database };
}
