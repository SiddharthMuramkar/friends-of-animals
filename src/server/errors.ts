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

/** A five-character SQLSTATE, as Postgres drivers put on `code`. */
function postgresCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) {
    return undefined;
  }
  const { code } = value;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
    ? code
    : undefined;
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
  const code = postgresCode(error) ?? postgresCode(error.cause);
  return code ? `${name} (Postgres ${code})` : name;
}
