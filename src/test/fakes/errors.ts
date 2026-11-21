import type { ErrorContext, ErrorReporter } from "@/server/ports/errors";
import type { SentEvent } from "@/server/ports/errors.contract";

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

  report(_error: unknown, _context?: ErrorContext): void {}

  async flush(): Promise<boolean> {
    return false;
  }

  /** Every error reported so far, oldest first. */
  get reported(): readonly ReportedError[] {
    return this.#reported;
  }
}
