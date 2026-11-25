// The last check before a row goes into someone's data export (#115b):
// every row must name one of the person's accounts or profiles, or a row
// an earlier section of the same export holds (their entry, their
// payment). A row that names neither is someone else's: the export fails
// closed and nothing is stored, rather than leak it.
//
// Pure, and loads under plain Node.

/** Thrown for a row that isn't the subject's. Names ids only. */
export class ForeignRowError extends Error {
  constructor(section: string, rowId: string) {
    super(`The ${section} row ${rowId} isn't the subject's: export refused`);
    this.name = "ForeignRowError";
  }
}

export function assertRowsBelongToSubject(
  section: string,
  rows: readonly Readonly<Record<string, unknown>>[],
  owners: readonly string[],
  allowed: ReadonlySet<string>
): void {
  for (const row of rows) {
    const owned = owners.some((owner) => {
      const value = row[owner];
      return typeof value === "string" && allowed.has(value);
    });
    if (!owned) {
      const id = row.id;
      throw new ForeignRowError(section, typeof id === "string" ? id : "?");
    }
  }
}

/** Signed timing evidence must name an actual owned auction payment,
 * not just any previously allowed id or an order at a different gateway. */
export function auctionCaptureBatchId(
  event: Readonly<Record<string, unknown>>,
  ownedBatches: readonly Readonly<Record<string, unknown>>[],
  userIds: ReadonlySet<string>
): string {
  const batch = ownedBatches.find(
    (row) =>
      row.purpose === "auction_sale" &&
      typeof row.payer_user_id === "string" &&
      userIds.has(row.payer_user_id) &&
      typeof event.gateway === "string" &&
      row.gateway === event.gateway &&
      typeof event.order_id === "string" &&
      row.gateway_order_id === event.order_id
  );
  if (
    event.type !== "payment.captured" ||
    !(event.capture_occurred_by instanceof Date) ||
    !Number.isFinite(+event.capture_occurred_by) ||
    typeof batch?.id !== "string"
  ) {
    throw new ForeignRowError(
      "gateway_webhook_event",
      typeof event.id === "string" ? event.id : "?"
    );
  }
  return batch.id;
}
