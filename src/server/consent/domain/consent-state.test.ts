import { describe, expect, it } from "vitest";

import {
  currentConsent,
  decideGive,
  decideWithdraw,
  type ConsentEventRecord,
  type ConsentState,
} from "./consent-state";

const V1 = { id: "0190a000-0000-7000-8000-000000000001", version: 1 };
const V2 = { id: "0190a000-0000-7000-8000-000000000002", version: 2 };

function event(
  id: string,
  action: ConsentEventRecord["action"],
  document: { id: string; version: number },
  occurredAt: string
): ConsentEventRecord {
  return {
    id,
    action,
    documentId: document.id,
    documentVersion: document.version,
    occurredAt: new Date(occurredAt),
  };
}

const NEVER: ConsentState = { status: "never" };
const GIVEN_V1: ConsentState = {
  status: "given",
  documentId: V1.id,
  documentVersion: 1,
  since: new Date("2027-01-15T04:30:00.000Z"),
};
const WITHDRAWN_V1: ConsentState = {
  status: "withdrawn",
  documentId: V1.id,
  documentVersion: 1,
  since: new Date("2027-01-16T04:30:00.000Z"),
};

describe("currentConsent", () => {
  it("is never given when there are no events", () => {
    expect(currentConsent([])).toEqual({ status: "never" });
  });

  it("is given on the version of the latest event", () => {
    expect(
      currentConsent([event("e1", "given", V1, "2027-01-15T04:30:00.000Z")])
    ).toEqual(GIVEN_V1);
  });

  it("follows a withdrawal, keeping the version that was withdrawn", () => {
    expect(
      currentConsent([
        event("e1", "given", V1, "2027-01-15T04:30:00.000Z"),
        event("e2", "withdrawn", V1, "2027-01-16T04:30:00.000Z"),
      ])
    ).toEqual(WITHDRAWN_V1);
  });

  it("orders by time, not by the order the events arrive in", () => {
    expect(
      currentConsent([
        event("e3", "given", V2, "2027-01-17T04:30:00.000Z"),
        event("e1", "given", V1, "2027-01-15T04:30:00.000Z"),
        event("e2", "withdrawn", V1, "2027-01-16T04:30:00.000Z"),
      ])
    ).toEqual({
      status: "given",
      documentId: V2.id,
      documentVersion: 2,
      since: new Date("2027-01-17T04:30:00.000Z"),
    });
  });

  it("breaks a tie on time by the time-ordered id", () => {
    const at = "2027-01-15T04:30:00.000Z";
    const given = event(
      "0190a000-0000-7000-8000-00000000000a",
      "given",
      V1,
      at
    );
    const withdrawn = event(
      "0190a000-0000-7000-8000-00000000000b",
      "withdrawn",
      V1,
      at
    );

    expect(currentConsent([withdrawn, given]).status).toBe("withdrawn");
    expect(currentConsent([given, withdrawn]).status).toBe("withdrawn");
  });
});

describe("decideGive", () => {
  it.each([
    {
      name: "records consent never given before",
      state: NEVER,
      latest: V1,
      requested: V1.id,
      decision: { kind: "record", action: "given", documentId: V1.id },
    },
    {
      name: "records consent again after a withdrawal",
      state: WITHDRAWN_V1,
      latest: V1,
      requested: V1.id,
      decision: { kind: "record", action: "given", documentId: V1.id },
    },
    {
      name: "records consent to a newer version",
      state: GIVEN_V1,
      latest: V2,
      requested: V2.id,
      decision: { kind: "record", action: "given", documentId: V2.id },
    },
    {
      name: "changes nothing when already given on the latest version",
      state: GIVEN_V1,
      latest: V1,
      requested: V1.id,
      decision: { kind: "unchanged" },
    },
    {
      name: "rejects a version that is no longer the latest",
      state: NEVER,
      latest: V2,
      requested: V1.id,
      decision: { kind: "reject", code: "document_outdated" },
    },
    {
      name: "rejects an outdated version even when already given on it",
      state: GIVEN_V1,
      latest: V2,
      requested: V1.id,
      decision: { kind: "reject", code: "document_outdated" },
    },
    {
      name: "rejects consent while no version is published",
      state: NEVER,
      latest: null,
      requested: V1.id,
      decision: { kind: "reject", code: "no_published_document" },
    },
  ])("$name", ({ state, latest, requested, decision }) => {
    expect(decideGive(state, latest, requested)).toEqual(decision);
  });
});

describe("decideWithdraw", () => {
  it("records a withdrawal of the version that was given", () => {
    expect(
      decideWithdraw({ ...GIVEN_V1, documentId: V2.id, documentVersion: 2 })
    ).toEqual({ kind: "record", action: "withdrawn", documentId: V2.id });
  });

  it.each([
    { name: "never given", state: NEVER },
    { name: "already withdrawn", state: WITHDRAWN_V1 },
  ])("changes nothing when $name", ({ state }) => {
    expect(decideWithdraw(state)).toEqual({ kind: "unchanged" });
  });
});
