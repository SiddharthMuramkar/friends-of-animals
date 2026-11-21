import { hashUserId, captureContext } from "@/server/ports/errors";
import type { ErrorContext, ErrorReporter } from "@/server/ports/errors";
import type { SentEvent } from "@/server/ports/errors.contract";
import { scrubEvent } from "@/lib/observability/scrub";

/**
 * The exception a Sentry SDK records for a thrown value: an Error's name
 * and message, or "Error" and the value as text.
 */
export function exceptionOf(error: unknown): { type: string; value: string } {
  return error instanceof Error
    ? { type: error.name, value: error.message }
    : { type: "Error", value: String(error) };
}

/** A reported error: the event as it would leave, plus the original. */
export type ReportedError = SentEvent & {
  /** The value passed to `report`, for `toBe` checks. Never sent. */
  error: unknown;
};

/**
 * In-memory error reporting for Seam 1 tests. It passes the same contract
 * as the Sentry adapter (src/server/ports/errors.contract.ts): every event
 * is scrubbed exactly as the SDK's `beforeSend` would scrub it.
 */
export class FakeErrorReporter implements ErrorReporter {
  readonly #reported: ReportedError[] = [];

  report(error: unknown, context?: ErrorContext): void {
    const event = scrubEvent(
      {
        exception: { values: [exceptionOf(error)] },
        ...captureContext(context),
      },
      { hashUserId }
    );
    const [exception] = event.exception.values;
    this.#reported.push({
      error,
      type: exception?.type ?? "Error",
      message: exception?.value ?? "",
      tags: event.tags ?? {},
      extra: event.extra ?? {},
      ...(event.user ? { user: event.user } : {}),
    });
  }

  async flush(): Promise<boolean> {
    return true;
  }

  /** Every error reported so far, oldest first. */
  get reported(): readonly ReportedError[] {
    return this.#reported;
  }
}
