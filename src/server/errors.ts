/**
 * Thrown by a use case for something the caller must never do, such as an
 * actor acting without permission. Expected outcomes (a wrong code, a rate
 * limit) are returned as results instead. Edges map `code` to a message.
 */
export class DomainError extends Error {
  readonly code: "forbidden";

  constructor(code: "forbidden", message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

/**
 * The Postgres error code (a five-character SQLSTATE) on a driver error, or
 * on an error it wraps (a DrizzleQueryError's `cause`).
 */
export function sqlState(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "object" || current === null) return undefined;
    const code = "code" in current ? current.code : undefined;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/**
 * What to log about an unexpected error: its class and any Postgres error
 * code, never its message. Messages carry personal data: a failed query's
 * message lists its parameters (addresses, sign-in codes).
 */
export function errorSummaryForLogs(error: unknown): string {
  if (!(error instanceof Error)) return `a thrown ${typeof error}`;
  const name =
    error.constructor.name === "Error" ? error.name : error.constructor.name;
  const code = sqlState(error);
  return code ? `${name} (Postgres ${code})` : name;
}
