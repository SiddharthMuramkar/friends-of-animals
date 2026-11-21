import { describe, expect, it } from "vitest";

import { SAMPLE_IMPACT } from "../../../content/sample";
import { visibleCounters } from "../../../content/sample/selectors";
import { impactKind } from "./impact";

function refused(value: unknown): string[] {
  const result = impactKind.parse(value);
  if (result.ok) throw new Error("expected the body to be refused");
  return result.issues;
}

describe("impact kind", () => {
  it("seeds the sample counters", () => {
    expect(impactKind.seedBody()).toEqual(SAMPLE_IMPACT);
    expect(impactKind.parse(SAMPLE_IMPACT)).toEqual({
      ok: true,
      body: SAMPLE_IMPACT,
    });
  });

  it("accepts new values and a new date", () => {
    const body = {
      asOf: "2027-03-31",
      counters: [
        { key: "participants", value: 4210 },
        { key: "certificatesIssued", value: 3999 },
      ],
    };
    expect(impactKind.parse(body)).toEqual({ ok: true, body });
  });

  it.each(["fundsRaised", "funds"])(
    "refuses %s, which is computed from the accounts",
    (key) => {
      const issues = refused({
        asOf: "2027-03-31",
        counters: [{ key, value: 100000 }],
      });
      expect(issues.some((i) => i.startsWith("counters.0.key"))).toBe(true);
    }
  );

  it.each([
    ["a negative value", -1],
    ["a fraction", 12.5],
    ["text", "1,240"],
  ])("refuses %s", (_, value) => {
    const issues = refused({
      asOf: "2027-03-31",
      counters: [{ key: "participants", value }],
    });
    expect(issues.some((i) => i.startsWith("counters.0.value"))).toBe(true);
  });

  it.each(["2027-02-30", "31/03/2027", "", "today"])(
    "refuses the date %j",
    (asOf) => {
      const issues = refused({
        asOf,
        counters: [{ key: "participants", value: 10 }],
      });
      expect(issues.some((i) => i.startsWith("asOf"))).toBe(true);
    }
  );

  it("refuses a counter listed twice", () => {
    const issues = refused({
      asOf: "2027-03-31",
      counters: [
        { key: "participants", value: 10 },
        { key: "participants", value: 20 },
      ],
    });
    expect(issues).toContain("counters: participants is listed more than once");
  });

  it("refuses no counters at all", () => {
    expect(refused({ asOf: "2027-03-31", counters: [] }).length).toBe(1);
  });

  it("still hides small counts when shown", () => {
    const result = impactKind.parse({
      asOf: "2027-03-31",
      counters: [
        { key: "participants", value: 1249 },
        { key: "institutions", value: 9 },
      ],
    });
    expect(result.ok && visibleCounters(result.body.counters)).toEqual([
      { key: "participants", display: "1,240+" },
    ]);
  });

  it("renders a stored body that no longer fits as no counters, never the sample", () => {
    const shown = impactKind.sanitize({ asOf: "2027-03-31", counters: "lots" });
    expect(shown.counters).toEqual([]);
  });
});
