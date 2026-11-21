// The arguments, configuration and exit codes of `pnpm files:purge-preview`,
// kept apart from the script so they can be tested without R2.
//
// Exit codes: 0 purged (or nothing was there); 2 bad arguments or a target
// that must not be purged; 1 missing configuration or a storage failure.

import { parseArgs } from "node:util";

import { parseEnv, purgeEnvSchema } from "../src/env.schema";
import { errorSummaryForLogs } from "../src/server/errors";
import {
  purgePreviewFiles,
  PurgeRefusedError,
} from "../src/server/modules/files/purge";
import type { ObjectStorage } from "../src/server/ports/storage";
import type { R2Config } from "../src/server/ports/storage-r2";

export const PURGE_USAGE = "Usage: pnpm files:purge-preview --database <name>";

export type R2Credentials = R2Config;

export type PurgeArgs =
  | { ok: true; database: string }
  | { ok: false; error: string };

export function parsePurgeArgs(argv: readonly string[]): PurgeArgs {
  // `pnpm <script> -- --database x` passes the separator on.
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let database: string | undefined;
  try {
    ({
      values: { database },
    } = parseArgs({
      args,
      options: { database: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${reason}\n${PURGE_USAGE}` };
  }
  if (!database) {
    return {
      ok: false,
      error: `Name the dropped database with --database.\n${PURGE_USAGE}`,
    };
  }
  return { ok: true, database };
}

/**
 * Parses `argv` and `env`, purges, and returns the exit code. Messages
 * never carry the R2 credentials: configuration errors name variables, and
 * a storage failure is reported by its class only.
 */
export async function runPurgePreviewFiles({
  argv,
  env,
  openStorage,
  log,
  error,
}: {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  openStorage: (credentials: R2Credentials) => ObjectStorage;
  log: (line: string) => void;
  error: (line: string) => void;
}): Promise<number> {
  const args = parsePurgeArgs(argv);
  if (!args.ok) {
    error(args.error);
    return 2;
  }

  let config;
  try {
    config = parseEnv(purgeEnvSchema, env);
  } catch (problem) {
    error(problem instanceof Error ? problem.message : String(problem));
    return 1;
  }
  const storage = openStorage({
    accountId: config.R2_ACCOUNT_ID,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  });

  try {
    const { prefix, deleted } = await purgePreviewFiles(
      { storage, bucket: config.R2_BUCKET, appEnv: config.APP_ENV },
      { database: args.database }
    );
    log(
      `Purged ${deleted} object(s) under ${prefix} in ${config.R2_BUCKET} ` +
        `(database ${args.database}).`
    );
    return 0;
  } catch (problem) {
    if (problem instanceof PurgeRefusedError) {
      error(problem.message);
      return 2;
    }
    error(
      `Purge of ${args.database}'s files failed: ` +
        `${errorSummaryForLogs(problem)}. Some objects may remain; ` +
        "running it again is safe."
    );
    return 1;
  }
}
