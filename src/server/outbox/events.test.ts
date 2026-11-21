import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EVENT_PAYLOADS } from "./events";

/**
 * The fields of `payload` that could carry personal data: anything but an
 * id (UUID), an enum, a whole number, a boolean or an ISO date. Widening
 * this list is a decision for a reviewer, not a side effect of a new event.
 */
function fieldsThatMayCarryPersonalData(payload: z.ZodObject): string[] {
  return Object.entries(payload.shape)
    .filter(([, field]) => !isIdLike(field as z.ZodType))
    .map(([name]) => name);
}

function isIdLike(field: z.ZodType): boolean {
  if (field instanceof z.ZodOptional || field instanceof z.ZodNullable) {
    return isIdLike(field.unwrap() as z.ZodType);
  }
  return (
    field instanceof z.ZodUUID ||
    field instanceof z.ZodEnum ||
    field instanceof z.ZodBoolean ||
    field instanceof z.ZodISODateTime ||
    field instanceof z.ZodISODate ||
    (field instanceof z.ZodNumberFormat && field.format === "safeint")
  );
}

describe("EVENT_PAYLOADS", () => {
  it("holds ids, enums, whole numbers, booleans and ISO dates only", () => {
    const offending = Object.entries(EVENT_PAYLOADS).flatMap(
      ([type, payload]) =>
        fieldsThatMayCarryPersonalData(payload).map(
          (field) => `${type}.${field}`
        )
    );
    expect(offending).toEqual([]);
  });

  it("would refuse a payload field that could hold an address, a name or a code", () => {
    const payload = z.object({
      userId: z.uuid(),
      reason: z.enum(["expired", "revoked"]).optional(),
      attempts: z.int(),
      paid: z.boolean(),
      dueOn: z.iso.date(),
      at: z.iso.datetime(),
      email: z.email(),
      name: z.string(),
      code: z.string().regex(/^\d{6}$/),
      amount: z.number(),
      details: z.object({ userId: z.uuid() }),
    });

    expect(fieldsThatMayCarryPersonalData(payload)).toEqual([
      "email",
      "name",
      "code",
      "amount",
      "details",
    ]);
  });
});
