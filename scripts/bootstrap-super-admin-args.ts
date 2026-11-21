export type BootstrapArgs =
  | { ok: true; email: string; name: string }
  | { ok: false; error: string };

export function parseBootstrapArgs(_argv: readonly string[]): BootstrapArgs {
  return { ok: false, error: "" };
}
