// Physical artwork custody rules (#94): what verifying a received work,
// raising or resolving a discrepancy, exhibiting, storing, moving,
// retaining, a family's return request and recording a return do to one
// artwork. Pure: the use cases load the artwork, call `decideCustody`,
// then write the status, the verification or discrepancy record, the
// custody event, the audit row and the outbox event it names. Nothing here
// reads the database, the clock or the settings; `now`, the return window
// and the photos' scan states come in.
//
// The single "physically ready for judging" check that FOA rounds rely on
// lives here too, so rounds (#95, #97, #98) and auctions (#131) share one
// definition.
//
// Loads under plain Node: no "server-only", no `@/` imports.

/**
 * Every `physical_artwork_status` value. A stand-in for the same list in
 * #93's `./status`: once both are on one branch, import
 * `PHYSICAL_ARTWORK_STATUSES` and `PhysicalArtworkStatus` from there and
 * delete these two.
 */
export const PHYSICAL_ARTWORK_STATUSES = [
  "requested",
  "dispatched",
  "received",
  "discrepancy",
  "verified",
  "on_exhibition",
  "retained",
  "returned",
] as const;

export type PhysicalArtworkStatus = (typeof PHYSICAL_ARTWORK_STATUSES)[number];

/**
 * The status changes custody commands make, one row per pair, in the shape
 * of #93's `ARTWORK_TRANSITIONS` so they can be appended to it. `via` names
 * the command; on_exhibition → retained is also reached by `store` for a
 * work FOA had already retained.
 */
export const CUSTODY_TRANSITIONS = [
  { from: "received", to: "verified", via: "verify" },
  { from: "received", to: "discrepancy", via: "raise_discrepancy" },
  { from: "discrepancy", to: "received", via: "resolve_discrepancy" },
  { from: "verified", to: "on_exhibition", via: "exhibit" },
  { from: "retained", to: "on_exhibition", via: "exhibit" },
  { from: "on_exhibition", to: "verified", via: "store" },
  { from: "verified", to: "retained", via: "retain" },
  { from: "on_exhibition", to: "retained", via: "retain" },
  { from: "received", to: "returned", via: "record_return" },
  { from: "discrepancy", to: "returned", via: "record_return" },
  { from: "verified", to: "returned", via: "record_return" },
  { from: "on_exhibition", to: "returned", via: "record_return" },
] as const satisfies readonly {
  from: PhysicalArtworkStatus;
  to: PhysicalArtworkStatus;
  via: CustodyCommand["kind"];
}[];

/** The statuses in which FOA holds a verified work it can judge. */
export const READY_FOR_JUDGING_STATUSES = [
  "verified",
  "on_exhibition",
  "retained",
] as const satisfies readonly PhysicalArtworkStatus[];

/**
 * True only for a verified, on-exhibition or retained artwork. `null` means
 * the entry has no physical artwork, which is never ready.
 */
export function isPhysicallyReadyForJudging(
  status: PhysicalArtworkStatus | null
): boolean {
  return (
    status !== null &&
    (READY_FOR_JUDGING_STATUSES as readonly string[]).includes(status)
  );
}

/** Bounds of the `artwork.returnWindowDays` setting. */
export const RETURN_WINDOW_DAYS = { default: 30, min: 1, max: 365 } as const;

/** When a competition's families may ask for their work back. */
export type ReturnWindow = {
  /** Results were published at this instant. */
  opensAt: Date;
  /** Requests are refused from this instant on. */
  closesAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The return window for results published at `resultsPublishedAt`. India
 * has no daylight saving, so N days is exactly N × 24 hours.
 */
export function returnWindowFor(
  resultsPublishedAt: Date,
  days: number
): ReturnWindow {
  if (
    !Number.isInteger(days) ||
    days < RETURN_WINDOW_DAYS.min ||
    days > RETURN_WINDOW_DAYS.max
  ) {
    throw new RangeError(
      `Return window days must be a whole number from ${RETURN_WINDOW_DAYS.min} to ${RETURN_WINDOW_DAYS.max}, got ${days}`
    );
  }
  return {
    opensAt: resultsPublishedAt,
    closesAt: new Date(resultsPublishedAt.getTime() + days * DAY_MS),
  };
}

/** What a verifier checks against the digital entry, each pass or fail. */
export const CHECKLIST_ITEMS = [
  "codeMatchesLabel",
  "creatorConfirmed",
  "matchesDigital",
  "consentDocumentsOk",
] as const;

export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

export const ARTWORK_CONDITIONS = [
  "excellent",
  "good",
  "fair",
  "damaged",
] as const;

export type ArtworkCondition = (typeof ARTWORK_CONDITIONS)[number];

export const CONDITION_PHOTO_KINDS = ["front", "back", "detail"] as const;

export type ConditionPhotoKind = (typeof CONDITION_PHOTO_KINDS)[number];

/** How many condition photos one verification takes. */
export const CONDITION_PHOTOS = { min: 2, max: 12 } as const;

/** Largest side of a work we record, in millimetres (10 m). */
export const MAX_DIMENSION_MM = 10_000;

/** Longest material or storage location, in characters. */
export const SHORT_TEXT_MAX = 120;

/** Longest condition, discrepancy or resolution note, in characters. */
export const NOTES_MAX = 1000;

/** Why a verifier raised a discrepancy. */
export const DISCREPANCY_REASONS = [
  "mismatch",
  "damage",
  "wrong_creator",
  "missing_documents",
  "other",
] as const;

export type DiscrepancyReason = (typeof DISCREPANCY_REASONS)[number];

/** The verification form, as the edge's schema parsed it. */
export type VerificationInput = {
  checklist: Record<ChecklistItem, boolean>;
  /** One of `ARTWORK_CONDITIONS`; checked here. */
  condition: string;
  /** Required when the work is damaged. */
  conditionNotes: string | null;
  widthMm: number;
  heightMm: number;
  /** For three-dimensional work only. */
  depthMm: number | null;
  material: string;
  /** Free text, such as `MUM/STORE-1/RACK-B/SHELF-2`. */
  storageLocation: string;
  /** The uploaded photos, with their file's current scan status. */
  photos: readonly {
    fileId: string;
    kind: ConditionPhotoKind;
    fileStatus: string;
  }[];
};

/** What a successful verification stores. */
export type VerificationRecord = {
  checklist: Record<ChecklistItem, boolean>;
  condition: ArtworkCondition;
  conditionNotes: string | null;
  widthMm: number;
  heightMm: number;
  depthMm: number | null;
  material: string;
  photos: { fileId: string; kind: ConditionPhotoKind }[];
};

/** What the use case knows about the artwork when a command arrives. */
export type CustodyState = {
  status: PhysicalArtworkStatus;
  /** Null until the competition's results are published. */
  returnWindow: ReturnWindow | null;
  /** An open return request exists. */
  returnRequested: boolean;
  /** Set once FOA retained the work. */
  retainedAt: Date | null;
};

export type CustodyCommand =
  /** A verifier verifies a received work against its digital entry. */
  | { kind: "verify"; input: VerificationInput }
  /** A verifier records that the work doesn't match or isn't complete. */
  | {
      kind: "raise_discrepancy";
      /** One of `DISCREPANCY_REASONS`; checked here. */
      reason: string;
      notes: string | null;
    }
  /** Staff close the open discrepancy; the work can then be verified. */
  | { kind: "resolve_discrepancy"; resolution: string | null }
  /** Staff put a verified or retained work on exhibition. */
  | { kind: "exhibit"; location: string }
  /** Staff bring an exhibited work back into storage. */
  | { kind: "store"; location: string }
  /** Staff move a work within the facility; its status stays. */
  | { kind: "move"; location: string }
  /** FOA keeps a work nobody asked for: the window-close job, or staff. */
  | { kind: "retain" }
  /** The family or coordinator asks for the work back. */
  | { kind: "request_return" }
  /** Staff record that the work left FOA's custody. */
  | { kind: "record_return"; via: ReturnVia };

/** How a work went back, as the edge's schema parsed it. */
export type ReturnVia =
  | { method: "courier"; courierName: string; trackingNumber: string }
  | { method: "hand_over"; receivedBy: string };

export type CustodyRefusal =
  | "not_received"
  | "already_returned"
  | "already_verified"
  | "discrepancy_open"
  | "no_open_discrepancy"
  | "checklist_failed"
  | "photos_too_few"
  | "photos_too_many"
  | "photo_front_and_back_required"
  | "photo_duplicate"
  | "photo_not_ready"
  | "dimensions_invalid"
  | "material_required"
  | "material_too_long"
  | "condition_invalid"
  | "condition_notes_required"
  | "reason_invalid"
  | "notes_required"
  | "resolution_required"
  | "notes_too_long"
  | "location_required"
  | "location_too_long"
  | "not_verified"
  | "already_on_exhibition"
  | "not_on_exhibition"
  | "already_retained"
  | "results_not_published"
  | "return_window_open"
  | "return_requested"
  | "return_window_not_open"
  | "return_window_closed"
  | "return_already_requested"
  | "no_return_request"
  | "return_details_required"
  | "return_details_too_long";

/**
 * A custody log row to append: what happened and where the work is now.
 * `location` is null when the work didn't move (retained) or left FOA
 * (returned).
 */
export type CustodyEntry =
  | { kind: "stored" | "exhibited" | "moved"; location: string }
  | { kind: "retained" | "returned"; location: null };

export type CustodyDecision =
  | {
      ok: true;
      kind: "verify";
      to: "verified";
      event: "artwork.verified";
      custody: CustodyEntry;
      verification: VerificationRecord;
    }
  | {
      ok: true;
      kind: "raise_discrepancy";
      to: "discrepancy";
      event: "artwork.discrepancy_raised";
      custody: null;
      discrepancy: { reason: DiscrepancyReason; notes: string };
    }
  | {
      ok: true;
      kind: "resolve_discrepancy";
      to: "received";
      event: "artwork.discrepancy_resolved";
      custody: null;
      resolution: string;
    }
  | {
      ok: true;
      kind: "exhibit";
      to: "on_exhibition";
      event: "artwork.exhibited";
      custody: CustodyEntry;
    }
  | {
      ok: true;
      kind: "store";
      to: "verified" | "retained";
      event: "artwork.stored";
      custody: CustodyEntry;
    }
  | {
      ok: true;
      kind: "move";
      to: PhysicalArtworkStatus;
      event: null;
      custody: CustodyEntry;
    }
  | {
      ok: true;
      kind: "retain";
      to: "retained";
      event: "artwork.retained";
      custody: CustodyEntry;
    }
  | {
      ok: true;
      kind: "request_return";
      to: PhysicalArtworkStatus;
      event: "artwork.return_requested";
      custody: null;
    }
  | {
      ok: true;
      kind: "record_return";
      to: "returned";
      event: "artwork.returned";
      custody: CustodyEntry;
      via: ReturnVia;
    }
  | { ok: false; code: CustodyRefusal; failed?: ChecklistItem[] };

/** The outbox event types `decideCustody` names. */
export type CustodyEventType = NonNullable<
  Extract<CustodyDecision, { ok: true }>["event"]
>;

type Parsed<T> = { ok: true; value: T } | { ok: false; code: CustodyRefusal };

function refuse(code: CustodyRefusal): CustodyDecision {
  return { ok: false, code };
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: string
): value is T {
  return (values as readonly string[]).includes(value);
}

/** One line of text: trimmed, inner whitespace collapsed; null if empty. */
function cleanLine(value: string | null): string | null {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text === "" ? null : text;
}

/** A note keeps its line breaks; only the ends are trimmed. */
function cleanNotes(value: string | null): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}

function parseLine(
  value: string,
  required: CustodyRefusal,
  tooLong: CustodyRefusal
): Parsed<string> {
  const text = cleanLine(value);
  if (text === null) return { ok: false, code: required };
  if (text.length > SHORT_TEXT_MAX) return { ok: false, code: tooLong };
  return { ok: true, value: text };
}

function parseNotes(
  value: string | null,
  required: CustodyRefusal | null
): Parsed<string | null> {
  const text = cleanNotes(value);
  if (text === null) {
    return required ? { ok: false, code: required } : { ok: true, value: null };
  }
  if (text.length > NOTES_MAX) return { ok: false, code: "notes_too_long" };
  return { ok: true, value: text };
}

function isDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION_MM;
}

/**
 * Why a verifier can't verify, or raise a discrepancy on, an artwork in
 * this status, if they can't. Both happen only while it is received.
 */
function inspectionRefusal(
  status: PhysicalArtworkStatus
): CustodyRefusal | null {
  switch (status) {
    case "received":
      return null;
    case "requested":
    case "dispatched":
      return "not_received";
    case "discrepancy":
      return "discrepancy_open";
    case "returned":
      return "already_returned";
    case "verified":
    case "on_exhibition":
    case "retained":
      return "already_verified";
  }
}

function photosRefusal(
  photos: VerificationInput["photos"]
): CustodyRefusal | null {
  if (photos.length < CONDITION_PHOTOS.min) return "photos_too_few";
  if (photos.length > CONDITION_PHOTOS.max) return "photos_too_many";
  if (new Set(photos.map((photo) => photo.fileId)).size !== photos.length) {
    return "photo_duplicate";
  }
  const kinds = new Set(photos.map((photo) => photo.kind));
  if (!kinds.has("front") || !kinds.has("back")) {
    return "photo_front_and_back_required";
  }
  if (photos.some((photo) => photo.fileStatus !== "clean")) {
    return "photo_not_ready";
  }
  return null;
}

function verifyArtwork(
  state: CustodyState,
  input: VerificationInput
): CustodyDecision {
  const statusRefusal = inspectionRefusal(state.status);
  if (statusRefusal) return refuse(statusRefusal);

  const failed = CHECKLIST_ITEMS.filter((item) => !input.checklist[item]);
  if (failed.length > 0) return { ok: false, code: "checklist_failed", failed };

  const photoRefusal = photosRefusal(input.photos);
  if (photoRefusal) return refuse(photoRefusal);

  if (
    !isDimension(input.widthMm) ||
    !isDimension(input.heightMm) ||
    (input.depthMm !== null && !isDimension(input.depthMm))
  ) {
    return refuse("dimensions_invalid");
  }

  const material = parseLine(
    input.material,
    "material_required",
    "material_too_long"
  );
  if (!material.ok) return refuse(material.code);

  const condition = input.condition;
  if (!isOneOf(ARTWORK_CONDITIONS, condition)) {
    return refuse("condition_invalid");
  }
  const notes = parseNotes(
    input.conditionNotes,
    condition === "damaged" ? "condition_notes_required" : null
  );
  if (!notes.ok) return refuse(notes.code);

  const location = parseLine(
    input.storageLocation,
    "location_required",
    "location_too_long"
  );
  if (!location.ok) return refuse(location.code);

  return {
    ok: true,
    kind: "verify",
    to: "verified",
    event: "artwork.verified",
    custody: { kind: "stored", location: location.value },
    verification: {
      checklist: { ...input.checklist },
      condition,
      conditionNotes: notes.value,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      depthMm: input.depthMm,
      material: material.value,
      photos: input.photos.map(({ fileId, kind }) => ({ fileId, kind })),
    },
  };
}

function raiseDiscrepancy(
  state: CustodyState,
  reason: string,
  notesInput: string | null
): CustodyDecision {
  const statusRefusal = inspectionRefusal(state.status);
  if (statusRefusal) return refuse(statusRefusal);
  if (!isOneOf(DISCREPANCY_REASONS, reason)) return refuse("reason_invalid");
  const notes = parseNotes(notesInput, "notes_required");
  if (!notes.ok) return refuse(notes.code);
  return {
    ok: true,
    kind: "raise_discrepancy",
    to: "discrepancy",
    event: "artwork.discrepancy_raised",
    custody: null,
    discrepancy: { reason, notes: notes.value ?? "" },
  };
}

function resolveDiscrepancy(
  state: CustodyState,
  resolutionInput: string | null
): CustodyDecision {
  if (state.status !== "discrepancy") return refuse("no_open_discrepancy");
  const resolution = parseNotes(resolutionInput, "resolution_required");
  if (!resolution.ok) return refuse(resolution.code);
  return {
    ok: true,
    kind: "resolve_discrepancy",
    to: "received",
    event: "artwork.discrepancy_resolved",
    custody: null,
    resolution: resolution.value ?? "",
  };
}

/** Why a work can't be handled in this status: it isn't at FOA. */
function notHereRefusal(status: PhysicalArtworkStatus): CustodyRefusal | null {
  if (status === "requested" || status === "dispatched") return "not_received";
  if (status === "returned") return "already_returned";
  return null;
}

function location(value: string): Parsed<string> {
  return parseLine(value, "location_required", "location_too_long");
}

function exhibitArtwork(state: CustodyState, where: string): CustodyDecision {
  const away = notHereRefusal(state.status);
  if (away) return refuse(away);
  if (state.status === "on_exhibition") return refuse("already_on_exhibition");
  if (state.status !== "verified" && state.status !== "retained") {
    return refuse("not_verified");
  }
  const parsed = location(where);
  if (!parsed.ok) return refuse(parsed.code);
  return {
    ok: true,
    kind: "exhibit",
    to: "on_exhibition",
    event: "artwork.exhibited",
    custody: { kind: "exhibited", location: parsed.value },
  };
}

function storeArtwork(state: CustodyState, where: string): CustodyDecision {
  if (state.status !== "on_exhibition") return refuse("not_on_exhibition");
  const parsed = location(where);
  if (!parsed.ok) return refuse(parsed.code);
  return {
    ok: true,
    kind: "store",
    // A work FOA already retained stays retained after its exhibition.
    to: state.retainedAt ? "retained" : "verified",
    event: "artwork.stored",
    custody: { kind: "stored", location: parsed.value },
  };
}

function moveArtwork(state: CustodyState, where: string): CustodyDecision {
  const away = notHereRefusal(state.status);
  if (away) return refuse(away);
  const parsed = location(where);
  if (!parsed.ok) return refuse(parsed.code);
  return {
    ok: true,
    kind: "move",
    to: state.status,
    event: null,
    custody: { kind: "moved", location: parsed.value },
  };
}

function retainArtwork(state: CustodyState, now: Date): CustodyDecision {
  const away = notHereRefusal(state.status);
  if (away) return refuse(away);
  if (state.status === "retained") return refuse("already_retained");
  if (state.status !== "verified" && state.status !== "on_exhibition") {
    return refuse("not_verified");
  }
  if (!state.returnWindow) return refuse("results_not_published");
  if (now.getTime() < state.returnWindow.closesAt.getTime()) {
    return refuse("return_window_open");
  }
  if (state.returnRequested) return refuse("return_requested");
  return {
    ok: true,
    kind: "retain",
    to: "retained",
    event: "artwork.retained",
    custody: { kind: "retained", location: null },
  };
}

function requestReturn(state: CustodyState, now: Date): CustodyDecision {
  const window = state.returnWindow;
  if (!window || now.getTime() < window.opensAt.getTime()) {
    return refuse("return_window_not_open");
  }
  if (now.getTime() >= window.closesAt.getTime()) {
    return refuse("return_window_closed");
  }
  if (state.returnRequested) return refuse("return_already_requested");
  const away = notHereRefusal(state.status);
  if (away) return refuse(away);
  if (state.status === "retained") return refuse("already_retained");
  return {
    ok: true,
    kind: "request_return",
    to: state.status,
    event: "artwork.return_requested",
    custody: null,
  };
}

function returnDetails(value: string): Parsed<string> {
  return parseLine(value, "return_details_required", "return_details_too_long");
}

function parseReturnVia(via: ReturnVia): Parsed<ReturnVia> {
  if (via.method === "hand_over") {
    const receivedBy = returnDetails(via.receivedBy);
    if (!receivedBy.ok) return receivedBy;
    return {
      ok: true,
      value: { method: "hand_over", receivedBy: receivedBy.value },
    };
  }
  const courierName = returnDetails(via.courierName);
  if (!courierName.ok) return courierName;
  const trackingNumber = returnDetails(via.trackingNumber);
  if (!trackingNumber.ok) return trackingNumber;
  return {
    ok: true,
    value: {
      method: "courier",
      courierName: courierName.value,
      trackingNumber: trackingNumber.value,
    },
  };
}

function recordReturn(state: CustodyState, via: ReturnVia): CustodyDecision {
  const away = notHereRefusal(state.status);
  if (away) return refuse(away);
  if (state.status === "retained") return refuse("already_retained");
  // A verified work goes back only when its family asked within the
  // window. A work that never passed verification (received, or with a
  // discrepancy) can go back at any time, for example when the entry is
  // withdrawn or rejected.
  if (
    (state.status === "verified" || state.status === "on_exhibition") &&
    !state.returnRequested
  ) {
    return refuse("no_return_request");
  }
  const parsed = parseReturnVia(via);
  if (!parsed.ok) return refuse(parsed.code);
  return {
    ok: true,
    kind: "record_return",
    to: "returned",
    event: "artwork.returned",
    custody: { kind: "returned", location: null },
    via: parsed.value,
  };
}

/**
 * What `command` does to an artwork in `state` at `now`: the status it
 * moves to, the custody entry and outbox event to write, and the record to
 * store, or why it is refused. Throws only on input the schema and the
 * settings registry never produce.
 */
export function decideCustody(
  state: CustodyState,
  command: CustodyCommand,
  now: Date
): CustodyDecision {
  switch (command.kind) {
    case "verify":
      return verifyArtwork(state, command.input);
    case "raise_discrepancy":
      return raiseDiscrepancy(state, command.reason, command.notes);
    case "resolve_discrepancy":
      return resolveDiscrepancy(state, command.resolution);
    case "exhibit":
      return exhibitArtwork(state, command.location);
    case "store":
      return storeArtwork(state, command.location);
    case "move":
      return moveArtwork(state, command.location);
    case "retain":
      return retainArtwork(state, now);
    case "request_return":
      return requestReturn(state, now);
    case "record_return":
      return recordReturn(state, command.via);
  }
}
