// What a look at the gateway means for one recurring donation (#107). Any
// signal (a subscription webhook, the Checkout return, a cancel, a sweep)
// only says "look again": the use case fetches the subscription and its
// charges, then this decides, inside one transaction, which status move to
// make, which charges become donations, which late charges are refunded,
// whether the donor hears about a failed charge, and whether to ask the
// gateway to cancel. It doesn't matter how often or in what order the
// signals arrive: a handled payment or an announced failure is never acted
// on twice.
//
// Each charge to record still goes through the donations capture decision
// (FCRA refusal, amount check) before it becomes a donation. Pure; types and
// the state machine only.

import {
  type RecurringDonationEvent,
  type RecurringDonationStatus,
  isFinalRecurringStatus,
  nextRecurringStatus,
} from "./recurring-status";

/** The subscription as the gateway reports it now. */
export type RemoteSubscription = {
  /** As the gateway sends it, e.g. "active" or "pending". */
  status: string;
  /** Start of the billing cycle the gateway is on; null before authorisation. */
  currentStart: Date | null;
  /** When the gateway will next try to charge; null when it won't. */
  chargeAt: Date | null;
  /** When it was cancelled, completed or expired; null while live. */
  endedAt: Date | null;
};

/** One payment the gateway made or attempted on the subscription. */
export type RemoteCharge = {
  paymentId: string;
  /** True once the money was captured, even if it was refunded since. */
  captured: boolean;
  amountMinor: bigint;
  /** As the gateway sends it, e.g. "INR". */
  currency: string;
  /** True when the card or account was issued outside India. */
  international: boolean;
  /** When the payment attempt was created at the gateway. */
  createdAt: Date;
};

/** The recurring donation as stored. */
export type LocalRecurring = {
  status: RecurringDonationStatus;
  createdAt: Date;
  /** When the donor or finance asked to cancel; null if nobody has. */
  cancelRequestedAt: Date | null;
  /** When the cancellation was confirmed; null while live. */
  cancelledAt: Date | null;
};

export type RecurringSyncContext = {
  now: Date;
  /** Payments this donation already handled: donations and late refunds. */
  handledPaymentIds: ReadonlySet<string>;
  /** Billing cycles whose failure the donor was already told about. */
  noticedFailureCycles: ReadonlySet<string>;
  /** How long a new mandate may wait for authorisation (default 24 h). */
  authorisationWindowMs: number;
};

export type RecurringSyncPlan = {
  /** The status move to make, or null when the status stays. */
  move: {
    event: RecurringDonationEvent;
    from: RecurringDonationStatus;
    to: RecurringDonationStatus;
  } | null;
  /** The status after the move. */
  status: RecurringDonationStatus;
  /** New captured charges to turn into donations, oldest first. */
  record: RemoteCharge[];
  /** New captured charges made after cancellation: refund, no donation. */
  refundAfterCancel: RemoteCharge[];
  /** Tell the donor a charge failed in this billing cycle (once a cycle). */
  failureNotice: { cycleKey: string } | null;
  /** Ask the gateway to cancel: the donor asked, or nobody authorised. */
  cancelAtGateway: "requested" | "abandoned" | null;
  /** The next charge to show the donor, if one is coming. */
  nextChargeAt: Date | null;
  /** The gateway reports something the mirror can't follow; finance reviews. */
  conflict: { remoteStatus: string } | null;
};

/** The local status each gateway status corresponds to. */
const MIRRORED: Readonly<Record<string, RecurringDonationStatus>> = {
  created: "pending_authorisation",
  authenticated: "active",
  active: "active",
  pending: "past_due",
  halted: "halted",
  cancelled: "cancelled",
  expired: "cancelled",
  completed: "completed",
};

/** Gateway statuses after which it will never charge again. */
const ENDED = new Set(["cancelled", "completed", "expired"]);

function eventFor(
  remoteStatus: string,
  recordsCharges: boolean
): RecurringDonationEvent | null {
  switch (remoteStatus) {
    case "authenticated":
    case "active":
      return recordsCharges ? "charged" : "authorised";
    case "pending":
      return "charge_failed";
    case "halted":
      return "retries_exhausted";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "authorisation_expired";
    case "completed":
      return "completed";
    default:
      return null;
  }
}

const byCreation = (a: RemoteCharge, b: RemoteCharge) =>
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0);

/**
 * When charges stop counting as donations: the moment someone asked to
 * cancel, else the confirmed cancellation (ours, or the gateway's own).
 */
function cutOff(local: LocalRecurring, remote: RemoteSubscription) {
  if (local.cancelRequestedAt) return local.cancelRequestedAt;
  if (local.cancelledAt) return local.cancelledAt;
  if (remote.status === "cancelled" || remote.status === "expired") {
    return remote.endedAt;
  }
  return null;
}

export function planRecurringSync(
  local: LocalRecurring,
  remote: RemoteSubscription,
  charges: readonly RemoteCharge[],
  context: RecurringSyncContext
): RecurringSyncPlan {
  const stop = cutOff(local, remote);
  const fresh = charges
    .filter((c) => c.captured && !context.handledPaymentIds.has(c.paymentId))
    .sort(byCreation);
  const isLate = (c: RemoteCharge) =>
    stop !== null && c.createdAt.getTime() >= stop.getTime();
  const record = fresh.filter((c) => !isLate(c));
  const refundAfterCancel = fresh.filter(isLate);

  const target = MIRRORED[remote.status];
  let move: RecurringSyncPlan["move"] = null;
  let conflict: RecurringSyncPlan["conflict"] = null;
  if (target !== local.status) {
    const event = target ? eventFor(remote.status, record.length > 0) : null;
    const next = event ? nextRecurringStatus(local.status, event) : null;
    if (event && next?.ok) move = { event, from: local.status, to: next.to };
    else conflict = { remoteStatus: remote.status };
  }
  const status = move?.to ?? local.status;

  const requested = local.cancelRequestedAt !== null;
  let cancelAtGateway: RecurringSyncPlan["cancelAtGateway"] = null;
  if (requested && !ENDED.has(remote.status)) {
    cancelAtGateway = "requested";
  } else if (
    !requested &&
    local.status === "pending_authorisation" &&
    remote.status === "created" &&
    context.now.getTime() - local.createdAt.getTime() >=
      context.authorisationWindowMs
  ) {
    cancelAtGateway = "abandoned";
  }

  let failureNotice: RecurringSyncPlan["failureNotice"] = null;
  if (
    (remote.status === "pending" || remote.status === "halted") &&
    !requested &&
    !isFinalRecurringStatus(status)
  ) {
    const cycleKey = (remote.currentStart ?? remote.chargeAt)?.toISOString();
    const key = cycleKey ?? "first-cycle";
    if (!context.noticedFailureCycles.has(key)) {
      failureNotice = { cycleKey: key };
    }
  }

  const charging = status === "active" || status === "past_due";
  const nextChargeAt =
    charging && !requested && !conflict ? remote.chargeAt : null;

  return {
    move,
    status,
    record,
    refundAfterCancel,
    failureNotice,
    cancelAtGateway,
    nextChargeAt,
    conflict,
  };
}
