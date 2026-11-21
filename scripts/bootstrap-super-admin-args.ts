// The arguments of `pnpm admin:bootstrap-super-admin`, kept apart from the
// script so they can be tested without a database.

import { parseArgs } from "node:util";
import { z } from "zod";

export const BOOTSTRAP_USAGE =
  "Usage: pnpm admin:bootstrap-super-admin --email <address> [--name <name>]";

/** The name a new account gets when `--name` is left out. */
const DEFAULT_NAME = "FOA super admin";

export type BootstrapArgs =
  | { ok: true; email: string; name: string }
  | { ok: false; error: string };

export function parseBootstrapArgs(argv: readonly string[]): BootstrapArgs {
  // `pnpm <script> -- --email x` passes the separator on.
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let values: { email?: string; name?: string };
  try {
    ({ values } = parseArgs({
      args,
      options: { email: { type: "string" }, name: { type: "string" } },
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
  return {
    ok: true,
    email: email.data,
    name: values.name?.trim() || DEFAULT_NAME,
  };
}
