import { describe, expect, it } from "vitest";

import {
  CONDITION_PHOTOS,
  CUSTODY_TRANSITIONS,
  DISCREPANCY_REASONS,
  type CustodyCommand,
  type CustodyState,
  decideCustody,
  isPhysicallyReadyForJudging,
  PHYSICAL_ARTWORK_STATUSES,
  returnWindowFor,
  RETURN_WINDOW_DAYS,
  type VerificationInput,
} from "./custody";

const PUBLISHED = new Date("2027-04-10T12:30:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(PUBLISHED.getTime() + ms);

describe("physically ready for judging", () => {
  const truth: Record<string, boolean> = {
    requested: false,
    dispatched: false,
    received: false,
    discrepancy: false,
    verified: true,
    on_exhibition: true,
    retained: true,
    returned: false,
  };

  it.each(Object.entries(truth))("is %s → %s", (status, ready) => {
    expect(
      isPhysicallyReadyForJudging(
        status as (typeof PHYSICAL_ARTWORK_STATUSES)[number]
      )
    ).toBe(ready);
  });

  it("covers every status", () => {
    expect([...PHYSICAL_ARTWORK_STATUSES].sort()).toEqual(
      Object.keys(truth).sort()
    );
  });

  it("is false when the entry has no physical artwork", () => {
    expect(isPhysicallyReadyForJudging(null)).toBe(false);
  });
});

describe("the return window", () => {
  it("opens when results are published and lasts 30 days by default", () => {
    expect(RETURN_WINDOW_DAYS.default).toBe(30);
    expect(returnWindowFor(PUBLISHED, 30)).toEqual({
      opensAt: PUBLISHED,
      closesAt: new Date("2027-05-10T12:30:00.000Z"),
    });
  });

  it("follows the setting", () => {
    expect(returnWindowFor(PUBLISHED, 7).closesAt).toEqual(at(7 * DAY));
  });

  it.each([0, -1, 1.5, 366, Number.NaN])(
    "refuses %s days, which the settings registry never stores",
    (days) => {
      expect(() => returnWindowFor(PUBLISHED, days)).toThrow(RangeError);
    }
  );
});

const NOW = new Date("2027-03-01T04:30:00.000Z");

const state = (
  status: CustodyState["status"],
  more: Partial<CustodyState> = {}
): CustodyState => ({
  status,
  returnWindow: null,
  returnRequested: false,
  retainedAt: null,
  ...more,
});

const cleanPhotos: VerificationInput["photos"] = [
  { fileId: "f-front", kind: "front", fileStatus: "clean" },
  { fileId: "f-back", kind: "back", fileStatus: "clean" },
];

const goodInput: VerificationInput = {
  checklist: {
    codeMatchesLabel: true,
    creatorConfirmed: true,
    matchesDigital: true,
    consentDocumentsOk: true,
  },
  condition: "good",
  conditionNotes: null,
  widthMm: 297,
  heightMm: 420,
  depthMm: null,
  material: "  Watercolour on paper ",
  storageLocation: " MUM / store-1   rack B ",
  photos: cleanPhotos,
};

const verify = (input: Partial<VerificationInput> = {}): CustodyCommand => ({
  kind: "verify",
  input: { ...goodInput, ...input },
});

describe("verifying a received artwork", () => {
  it("verifies it and records where it is stored", () => {
    expect(decideCustody(state("received"), verify(), NOW)).toEqual({
      ok: true,
      kind: "verify",
      to: "verified",
      event: "artwork.verified",
      custody: { kind: "stored", location: "MUM / store-1 rack B" },
      verification: {
        checklist: goodInput.checklist,
        condition: "good",
        conditionNotes: null,
        widthMm: 297,
        heightMm: 420,
        depthMm: null,
        material: "Watercolour on paper",
        photos: cleanPhotos.map(({ fileId, kind }) => ({ fileId, kind })),
      },
    });
  });

  it("keeps a depth for three-dimensional work and trims notes", () => {
    const decision = decideCustody(
      state("received"),
      verify({ depthMm: 80, conditionNotes: "  Corner bent  " }),
      NOW
    );
    expect(decision).toMatchObject({
      ok: true,
      verification: { depthMm: 80, conditionNotes: "Corner bent" },
    });
  });

  it.each([
    ["requested", "not_received"],
    ["dispatched", "not_received"],
    ["discrepancy", "discrepancy_open"],
    ["verified", "already_verified"],
    ["on_exhibition", "already_verified"],
    ["retained", "already_verified"],
    ["returned", "already_returned"],
  ] as const)("refuses an artwork that is %s (%s)", (status, code) => {
    expect(decideCustody(state(status), verify(), NOW)).toEqual({
      ok: false,
      code,
    });
  });

  it("refuses a failed checklist and names every failed item", () => {
    expect(
      decideCustody(
        state("received"),
        verify({
          checklist: {
            codeMatchesLabel: true,
            creatorConfirmed: false,
            matchesDigital: false,
            consentDocumentsOk: true,
          },
        }),
        NOW
      )
    ).toEqual({
      ok: false,
      code: "checklist_failed",
      failed: ["creatorConfirmed", "matchesDigital"],
    });
  });

  describe("condition photos", () => {
    const photo = (
      fileId: string,
      kind: "front" | "back" | "detail",
      fileStatus = "clean"
    ) => ({ fileId, kind, fileStatus });

    it(`needs at least ${CONDITION_PHOTOS.min}`, () => {
      expect(CONDITION_PHOTOS.min).toBe(2);
      expect(
        decideCustody(
          state("received"),
          verify({ photos: [photo("a", "front")] }),
          NOW
        )
      ).toEqual({ ok: false, code: "photos_too_few" });
    });

    it(`takes at most ${CONDITION_PHOTOS.max}`, () => {
      const photos = [
        photo("front", "front"),
        photo("back", "back"),
        ...Array.from({ length: CONDITION_PHOTOS.max - 1 }, (_, i) =>
          photo(`d${i}`, "detail")
        ),
      ];
      expect(decideCustody(state("received"), verify({ photos }), NOW)).toEqual(
        { ok: false, code: "photos_too_many" }
      );
    });

    it("needs a front and a back", () => {
      expect(
        decideCustody(
          state("received"),
          verify({ photos: [photo("a", "front"), photo("b", "detail")] }),
          NOW
        )
      ).toEqual({ ok: false, code: "photo_front_and_back_required" });
    });

    it("refuses the same file twice", () => {
      expect(
        decideCustody(
          state("received"),
          verify({ photos: [photo("a", "front"), photo("a", "back")] }),
          NOW
        )
      ).toEqual({ ok: false, code: "photo_duplicate" });
    });

    it.each(["pending_upload", "uploaded", "scanning", "quarantined"])(
      "refuses a photo that is %s, not clean",
      (fileStatus) => {
        expect(
          decideCustody(
            state("received"),
            verify({
              photos: [photo("a", "front"), photo("b", "back", fileStatus)],
            }),
            NOW
          )
        ).toEqual({ ok: false, code: "photo_not_ready" });
      }
    );
  });

  it.each([
    [{ widthMm: 0 }],
    [{ heightMm: -5 }],
    [{ widthMm: 12.5 }],
    [{ heightMm: 10_001 }],
    [{ depthMm: 0 }],
    [{ widthMm: Number.NaN }],
  ])("refuses dimensions %o", (dimensions) => {
    expect(decideCustody(state("received"), verify(dimensions), NOW)).toEqual({
      ok: false,
      code: "dimensions_invalid",
    });
  });

  it.each([
    [{ material: "   " }, "material_required"],
    [{ material: "x".repeat(121) }, "material_too_long"],
    [{ condition: "mint" }, "condition_invalid"],
    [{ condition: "damaged" }, "condition_notes_required"],
    [{ conditionNotes: "x".repeat(1001) }, "notes_too_long"],
    [{ storageLocation: " \t " }, "location_required"],
    [{ storageLocation: "x".repeat(121) }, "location_too_long"],
  ] as const)("refuses %o with %s", (input, code) => {
    expect(decideCustody(state("received"), verify(input), NOW)).toEqual({
      ok: false,
      code,
    });
  });

  it("verifies damaged work when the damage is described", () => {
    expect(
      decideCustody(
        state("received"),
        verify({ condition: "damaged", conditionNotes: "Torn at the fold" }),
        NOW
      )
    ).toMatchObject({ ok: true, to: "verified" });
  });
});

describe("discrepancies", () => {
  const raise = (reason: string, notes: string | null): CustodyCommand => ({
    kind: "raise_discrepancy",
    reason,
    notes,
  });
  const resolve = (resolution: string | null): CustodyCommand => ({
    kind: "resolve_discrepancy",
    resolution,
  });

  it("offers the five reasons", () => {
    expect(DISCREPANCY_REASONS).toEqual([
      "mismatch",
      "damage",
      "wrong_creator",
      "missing_documents",
      "other",
    ]);
  });

  it("raises one on a received artwork, keeping line breaks in the notes", () => {
    expect(
      decideCustody(
        state("received"),
        raise("wrong_creator", "  Signed by a sibling.\nLabel says Asha.  "),
        NOW
      )
    ).toEqual({
      ok: true,
      kind: "raise_discrepancy",
      to: "discrepancy",
      event: "artwork.discrepancy_raised",
      custody: null,
      discrepancy: {
        reason: "wrong_creator",
        notes: "Signed by a sibling.\nLabel says Asha.",
      },
    });
  });

  it.each([
    ["requested", "not_received"],
    ["dispatched", "not_received"],
    ["discrepancy", "discrepancy_open"],
    ["verified", "already_verified"],
    ["on_exhibition", "already_verified"],
    ["retained", "already_verified"],
    ["returned", "already_returned"],
  ] as const)(
    "can't be raised on an artwork that is %s (%s)",
    (status, code) => {
      expect(
        decideCustody(state(status), raise("damage", "Torn"), NOW)
      ).toEqual({ ok: false, code });
    }
  );

  it.each([
    ["typo", "Torn", "reason_invalid"],
    ["damage", "   ", "notes_required"],
    ["damage", null, "notes_required"],
    ["damage", "x".repeat(1001), "notes_too_long"],
  ] as const)("refuses reason %s with notes %j (%s)", (reason, notes, code) => {
    expect(decideCustody(state("received"), raise(reason, notes), NOW)).toEqual(
      { ok: false, code }
    );
  });

  it("resolving one sends the work back to received, ready to verify", () => {
    const resolved = decideCustody(
      state("discrepancy"),
      resolve(" Coordinator confirmed the creator. "),
      NOW
    );
    expect(resolved).toEqual({
      ok: true,
      kind: "resolve_discrepancy",
      to: "received",
      event: "artwork.discrepancy_resolved",
      custody: null,
      resolution: "Coordinator confirmed the creator.",
    });
    expect(decideCustody(state("received"), verify(), NOW)).toMatchObject({
      ok: true,
      to: "verified",
    });
  });

  it("needs a resolution note", () => {
    expect(decideCustody(state("discrepancy"), resolve(" "), NOW)).toEqual({
      ok: false,
      code: "resolution_required",
    });
    expect(
      decideCustody(state("discrepancy"), resolve("x".repeat(1001)), NOW)
    ).toEqual({ ok: false, code: "notes_too_long" });
  });

  it.each(PHYSICAL_ARTWORK_STATUSES.filter((s) => s !== "discrepancy"))(
    "has nothing to resolve on an artwork that is %s",
    (status) => {
      expect(decideCustody(state(status), resolve("Fine"), NOW)).toEqual({
        ok: false,
        code: "no_open_discrepancy",
      });
    }
  );
});

const CLOSES = at(30 * DAY);
const WINDOW = { opensAt: PUBLISHED, closesAt: CLOSES };
const IN_WINDOW = at(29 * DAY);
const AFTER_WINDOW = at(31 * DAY);

const exhibit: CustodyCommand = { kind: "exhibit", location: "Gallery hall" };
const store: CustodyCommand = { kind: "store", location: "Store 1" };
const move: CustodyCommand = { kind: "move", location: " Store  2 " };
const retain: CustodyCommand = { kind: "retain" };
const requestReturn: CustodyCommand = { kind: "request_return" };
const recordReturn: CustodyCommand = {
  kind: "record_return",
  via: {
    method: "courier",
    courierName: " India Post ",
    trackingNumber: "EM123456789IN",
  },
};

describe("the physical artwork transition table", () => {
  // Each command runs where its context allows it, so only the status
  // decides: retain after the window closes with no request; a return
  // request inside the window; a recorded return against an open request.
  const commands = {
    verify: [verify(), {}, NOW],
    raise: [
      { kind: "raise_discrepancy", reason: "damage", notes: "Torn" },
      {},
      NOW,
    ],
    resolve: [{ kind: "resolve_discrepancy", resolution: "Fine" }, {}, NOW],
    exhibit: [exhibit, {}, NOW],
    store: [store, {}, NOW],
    move: [move, {}, NOW],
    retain: [retain, { returnWindow: WINDOW }, AFTER_WINDOW],
    request: [requestReturn, { returnWindow: WINDOW }, IN_WINDOW],
    return: [
      recordReturn,
      { returnWindow: WINDOW, returnRequested: true },
      IN_WINDOW,
    ],
  } satisfies Record<string, [CustodyCommand, Partial<CustodyState>, Date]>;

  type Outcome = string;
  const NR = "not_received";
  const AV = "already_verified";
  const AR = "already_returned";
  const NOD = "no_open_discrepancy";
  const NOE = "not_on_exhibition";
  const NV = "not_verified";
  const RET = "already_retained";

  // status → [verify, raise, resolve, exhibit, store, move, retain, request, return]
  // A status name is the status it moves to; anything else is the refusal.
  const table: Record<string, Outcome[]> = {
    requested: [NR, NR, NOD, NR, NOE, NR, NR, NR, NR],
    dispatched: [NR, NR, NOD, NR, NOE, NR, NR, NR, NR],
    received: [
      "verified",
      "discrepancy",
      NOD,
      NV,
      NOE,
      "received",
      NV,
      "received",
      "returned",
    ],
    discrepancy: [
      "discrepancy_open",
      "discrepancy_open",
      "received",
      NV,
      NOE,
      "discrepancy",
      NV,
      "discrepancy",
      "returned",
    ],
    verified: [
      AV,
      AV,
      NOD,
      "on_exhibition",
      NOE,
      "verified",
      "retained",
      "verified",
      "returned",
    ],
    on_exhibition: [
      AV,
      AV,
      NOD,
      "already_on_exhibition",
      "verified",
      "on_exhibition",
      "retained",
      "on_exhibition",
      "returned",
    ],
    retained: [AV, AV, NOD, "on_exhibition", NOE, "retained", RET, RET, RET],
    returned: [AR, AR, NOD, AR, NOE, AR, AR, AR, AR],
  };

  it("lists every status", () => {
    expect(Object.keys(table)).toEqual([...PHYSICAL_ARTWORK_STATUSES]);
  });

  it("lists exactly these status changes as rows for the machine's table", () => {
    const changes = new Set<string>();
    for (const [status, outcomes] of Object.entries(table)) {
      for (const outcome of outcomes) {
        if (outcome !== status && outcome in table) {
          changes.add(`${status}→${outcome}`);
        }
      }
    }
    expect(
      new Set(CUSTODY_TRANSITIONS.map((row) => `${row.from}→${row.to}`))
    ).toEqual(changes);
  });

  it.each(CUSTODY_TRANSITIONS.map((row) => [row.from, row.to, row.via, row]))(
    "%s → %s is reached by %s",
    (_from, _to, _via, row) => {
      const [command, more, now] = Object.values(commands).find(
        ([candidate]) => candidate.kind === row.via
      )!;
      const decision = decideCustody(state(row.from, more), command, now);
      expect(decision.ok && decision.to).toBe(row.to);
    }
  );

  it.each(Object.entries(table))("from %s", (status, expected) => {
    const actual = Object.values(commands).map(([command, more, now]) => {
      const decision = decideCustody(
        state(status as CustodyState["status"], more),
        command,
        now
      );
      return decision.ok ? decision.to : decision.code;
    });
    expect(actual).toEqual(expected);
  });
});

describe("exhibition and storage", () => {
  it("exhibits a verified work and logs where it went", () => {
    expect(decideCustody(state("verified"), exhibit, NOW)).toEqual({
      ok: true,
      kind: "exhibit",
      to: "on_exhibition",
      event: "artwork.exhibited",
      custody: { kind: "exhibited", location: "Gallery hall" },
    });
  });

  it("brings an exhibited work back to verified storage", () => {
    expect(decideCustody(state("on_exhibition"), store, NOW)).toEqual({
      ok: true,
      kind: "store",
      to: "verified",
      event: "artwork.stored",
      custody: { kind: "stored", location: "Store 1" },
    });
  });

  it("brings a retained work back to retained after its exhibition", () => {
    const retainedAt = at(30 * DAY);
    expect(
      decideCustody(state("on_exhibition", { retainedAt }), store, NOW)
    ).toMatchObject({ ok: true, to: "retained" });
  });

  it("moves a work within the facility without changing its status", () => {
    expect(decideCustody(state("retained"), move, NOW)).toEqual({
      ok: true,
      kind: "move",
      to: "retained",
      event: null,
      custody: { kind: "moved", location: "Store 2" },
    });
  });

  it.each([exhibit, store, move])("needs a location for %o", (command) => {
    const from = command.kind === "store" ? "on_exhibition" : "verified";
    expect(
      decideCustody(state(from), { ...command, location: "  " }, NOW)
    ).toEqual({ ok: false, code: "location_required" });
  });
});

describe("retaining unrequested work", () => {
  it("retains a verified work once the window has closed", () => {
    expect(
      decideCustody(state("verified", { returnWindow: WINDOW }), retain, CLOSES)
    ).toEqual({
      ok: true,
      kind: "retain",
      to: "retained",
      event: "artwork.retained",
      custody: { kind: "retained", location: null },
    });
  });

  it("waits for results", () => {
    expect(decideCustody(state("verified"), retain, AFTER_WINDOW)).toEqual({
      ok: false,
      code: "results_not_published",
    });
  });

  it("waits until the window closes", () => {
    expect(
      decideCustody(
        state("on_exhibition", { returnWindow: WINDOW }),
        retain,
        at(30 * DAY - 1)
      )
    ).toEqual({ ok: false, code: "return_window_open" });
  });

  it("never retains a work its family asked for", () => {
    expect(
      decideCustody(
        state("verified", { returnWindow: WINDOW, returnRequested: true }),
        retain,
        AFTER_WINDOW
      )
    ).toEqual({ ok: false, code: "return_requested" });
  });
});

describe("asking for the work back", () => {
  const verified = state("verified", { returnWindow: WINDOW });

  it("accepts a request inside the window", () => {
    expect(decideCustody(verified, requestReturn, IN_WINDOW)).toEqual({
      ok: true,
      kind: "request_return",
      to: "verified",
      event: "artwork.return_requested",
      custody: null,
    });
  });

  it.each([
    ["the instant results are published", PUBLISHED],
    ["the last millisecond", at(30 * DAY - 1)],
  ])("accepts one at %s", (_, now) => {
    expect(decideCustody(verified, requestReturn, now)).toMatchObject({
      ok: true,
    });
  });

  it("refuses one after the window closes", () => {
    expect(decideCustody(verified, requestReturn, CLOSES)).toEqual({
      ok: false,
      code: "return_window_closed",
    });
  });

  it("refuses one before results are published", () => {
    expect(decideCustody(state("verified"), requestReturn, IN_WINDOW)).toEqual({
      ok: false,
      code: "return_window_not_open",
    });
    expect(decideCustody(verified, requestReturn, at(-1))).toEqual({
      ok: false,
      code: "return_window_not_open",
    });
  });

  it("refuses a second request", () => {
    expect(
      decideCustody(
        state("verified", { returnWindow: WINDOW, returnRequested: true }),
        requestReturn,
        IN_WINDOW
      )
    ).toEqual({ ok: false, code: "return_already_requested" });
  });
});

describe("recording a return", () => {
  it("returns a requested work by courier", () => {
    expect(
      decideCustody(
        state("verified", { returnWindow: WINDOW, returnRequested: true }),
        recordReturn,
        IN_WINDOW
      )
    ).toEqual({
      ok: true,
      kind: "record_return",
      to: "returned",
      event: "artwork.returned",
      custody: { kind: "returned", location: null },
      via: {
        method: "courier",
        courierName: "India Post",
        trackingNumber: "EM123456789IN",
      },
    });
  });

  it("returns by hand to a named person", () => {
    expect(
      decideCustody(
        state("on_exhibition", { returnWindow: WINDOW, returnRequested: true }),
        {
          kind: "record_return",
          via: { method: "hand_over", receivedBy: " A. Rao " },
        },
        IN_WINDOW
      )
    ).toMatchObject({
      ok: true,
      via: { method: "hand_over", receivedBy: "A. Rao" },
    });
  });

  it.each(["verified", "on_exhibition"] as const)(
    "won't return a %s work nobody asked for",
    (status) => {
      expect(
        decideCustody(
          state(status, { returnWindow: WINDOW }),
          recordReturn,
          IN_WINDOW
        )
      ).toEqual({ ok: false, code: "no_return_request" });
    }
  );

  it.each(["received", "discrepancy"] as const)(
    "returns a %s work that was never verified without a request",
    (status) => {
      expect(decideCustody(state(status), recordReturn, NOW)).toMatchObject({
        ok: true,
        to: "returned",
      });
    }
  );

  it.each([
    [{ method: "courier", courierName: " ", trackingNumber: "X1" }],
    [{ method: "courier", courierName: "DTDC", trackingNumber: "" }],
    [{ method: "hand_over", receivedBy: "  " }],
  ] as const)("needs the return details %o", (via) => {
    expect(
      decideCustody(state("received"), { kind: "record_return", via }, NOW)
    ).toEqual({ ok: false, code: "return_details_required" });
  });

  it("refuses details longer than 120 characters", () => {
    expect(
      decideCustody(
        state("received"),
        {
          kind: "record_return",
          via: { method: "hand_over", receivedBy: "x".repeat(121) },
        },
        NOW
      )
    ).toEqual({ ok: false, code: "return_details_too_long" });
  });
});
