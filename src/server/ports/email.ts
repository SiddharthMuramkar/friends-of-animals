// The email port. Use cases send through it and never pick a provider.
// Adapters:
//   - capture (src/server/ports/email-capture.ts): stores each message in the
//     capture mailbox; every environment except production.
//   - the in-memory fake (src/test/fakes/email.ts): Seam 1 tests.
//   - SES (src/server/ports/email-ses.ts): production, once SES_* is set;
//     until then production gets `unconfiguredEmailSender`.
// Every adapter passes ./email.contract.ts.

/** One email. `text` is required; `html` is an optional alternative. */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string | undefined;
};

/** A message as a mailbox holds it: address normalised, time sent. */
export type ReceivedEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string | undefined;
  sentAt: Date;
};

export interface EmailSender {
  /**
   * Sends one message. With a tracked delivery ID, make one provider
   * attempt and use the ID for correlation where supported.
   */
  send(message: EmailMessage, options?: { deliveryId: string }): Promise<void>;
}

/** The provider definitely did not accept this send. */
export class EmailNotSentError extends Error {
  override name = "EmailNotSentError";
}

/**
 * How mailboxes compare and store addresses: trimmed and lower-cased, so
 * "Asha@Example.test" and "asha@example.test" are one recipient.
 */
export function normaliseEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * What may not appear in a subject: line breaks (CR, LF, U+2028, U+2029),
 * tabs and every other control character. A subject is one header line,
 * so a line break in it could start another header (a Bcc).
 */
const SUBJECT_BREAK = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/** Whether `subject` holds a line break or a control character. */
export function subjectHasBreak(subject: string): boolean {
  return new RegExp(SUBJECT_BREAK.source, "u").test(subject);
}

/**
 * `subject` on one line: each run of line breaks and control characters
 * becomes one space, and the ends are trimmed. For subjects rendered from
 * stored templates and people's names (#69).
 */
export function oneLineSubject(subject: string): string {
  return subject.replace(SUBJECT_BREAK, " ").trim();
}

/** Thrown in production while no real email provider is configured. */
export class EmailNotConfiguredError extends EmailNotSentError {
  constructor() {
    super(
      "No email provider is configured for production. Set " +
        "SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY and SES_FROM to send " +
        "through SES; codes are never captured in production."
    );
    this.name = "EmailNotConfiguredError";
  }
}

/** Production's sender while SES isn't configured: refuses every message. */
export const unconfiguredEmailSender: EmailSender = {
  send: () => Promise.reject(new EmailNotConfiguredError()),
};
