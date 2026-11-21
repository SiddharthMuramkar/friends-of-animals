// The arguments of `pnpm admin:bootstrap-super-admin` and the database it
// may write to, kept apart from the script so they can be tested without a
// database.

import { parseArgs } from "node:util";
import { z } from "zod";

import { hostInDoubt, notLocal } from "../src/server/seed/target";

export const BOOTSTRAP_USAGE =
  "Usage: pnpm admin:bootstrap-super-admin --email <address> [--name <name>] [--target <host>/<database>]";

/** The name a new account gets when `--name` is left out. */
const DEFAULT_NAME = "FOA super admin";

export type BootstrapArgs =
  | { ok: true; email: string; name: string; target?: string }
  | { ok: false; error: string };

export function parseBootstrapArgs(argv: readonly string[]): BootstrapArgs {
  // `pnpm <script> -- --email x` passes the separator on.
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let values: { email?: string; name?: string; target?: string };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        email: { type: "string" },
        name: { type: "string" },
        target: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${reason}\n${BOOTSTRAP_USAGE}` };
  }
  const email = z.email().safeParse(values.email?.trim());
  if (!email.success) {
    return {
      ok: false,
      error: `Give the account's address with --email.\n${BOOTSTRAP_USAGE}`,
    };
  }
  const target = values.target?.trim();
  return {
    ok: true,
    email: email.data,
    name: values.name?.trim() || DEFAULT_NAME,
    ...(target ? { target } : {}),
  };
}

export type BootstrapTarget =
  | { ok: true; host: string; database: string }
  | { ok: false; error: string };

/**
 * The host and database `url` writes to, if the bootstrap may: a local
 * database as it is, any other only when `confirmed` (the `--target`
 * argument) names the same `<host>/<database>`. Messages name the host and
 * database, never the password or the URL's query.
 */
export function bootstrapTarget(
  url: string,
  confirmed: string | undefined
): BootstrapTarget {
  const doubt = hostInDoubt(url);
  if (doubt) return { ok: false, error: doubt };
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const named = `${host}/${database}`;

  if (confirmed === undefined) {
    const refused = notLocal(url, "a bootstrap without --target");
    return refused
      ? {
          ok: false,
          error: `${refused} To bootstrap that database on purpose, pass --target ${named}.`,
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
