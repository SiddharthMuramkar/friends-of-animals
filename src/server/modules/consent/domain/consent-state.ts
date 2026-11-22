// Consent as an event log: every give and every withdrawal is one event,
// and the current state of a subject's consent to a purpose is the latest
// event. These rules are pure; the use cases load one subject's events for
// one purpose, decide, and append what the decision says.
//
// Loads under plain Node (schema, seed): relative imports only.

export type ConsentEventAction = "given" | "withdrawn";

/** One event as the rules need it, from one subject's log for one purpose. */
export type ConsentEventRecord = {
  /** UUIDv7, so ids made in the same millisecond still sort in order. */
  id: string;
  action: ConsentEventAction;
  documentId: string;
  documentVersion: number;
  occurredAt: Date;
};

export type ConsentState =
  | { status: "never" }
  | {
      status: "given" | "withdrawn";
      /** The document version given, or the one whose consent was withdrawn. */
      documentId: string;
      documentVersion: number;
      since: Date;
    };

/** The latest published version of the purpose's document. */
export type LatestDocument = { id: string; version: number };

export type ConsentDecision =
  | { kind: "record"; action: ConsentEventAction; documentId: string }
  | { kind: "unchanged" }
  | { kind: "reject"; code: "document_outdated" | "no_published_document" };

function isLater(a: ConsentEventRecord, b: ConsentEventRecord): boolean {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
  return byTime === 0 ? a.id > b.id : byTime > 0;
}

/** The state the latest event leaves, by time and then by id. */
export function currentConsent(
  events: readonly ConsentEventRecord[]
): ConsentState {
  let latest: ConsentEventRecord | undefined;
  for (const event of events) {
    if (!latest || isLater(event, latest)) latest = event;
  }
  if (!latest) return { status: "never" };
  return {
    status: latest.action,
    documentId: latest.documentId,
    documentVersion: latest.documentVersion,
    since: latest.occurredAt,
  };
}

/**
 * Whether giving consent to `requestedDocumentId` records an event. Consent
 * is only ever given to the latest published version, so it always points
 * at the text the person was shown; giving it again on that version changes
 * nothing.
 */
export function decideGive(
  state: ConsentState,
  latest: LatestDocument | null,
  requestedDocumentId: string
): ConsentDecision {
  if (!latest) return { kind: "reject", code: "no_published_document" };
  if (requestedDocumentId !== latest.id) {
    return { kind: "reject", code: "document_outdated" };
  }
  if (state.status === "given" && state.documentId === latest.id) {
    return { kind: "unchanged" };
  }
  return { kind: "record", action: "given", documentId: latest.id };
}

/**
 * When the next event for a subject happens: now, or 1 ms after the
 * subject's latest event if the clock reads no later than that (another
 * server's clock running behind, or two servers in one millisecond). The
 * use cases append under the subject's row lock, so this keeps the order
 * of the log the order the events were made in, and the latest event the
 * state.
 */
export function nextEventTime(state: ConsentState, now: Date): Date {
  if (state.status === "never" || now > state.since) return now;
  return new Date(state.since.getTime() + 1);
}

/** Withdrawing records an event only while consent is given. */
export function decideWithdraw(state: ConsentState): ConsentDecision {
  if (state.status !== "given") return { kind: "unchanged" };
  return { kind: "record", action: "withdrawn", documentId: state.documentId };
}
