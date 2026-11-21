import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, institution } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { registeredInstitution, validRegistration } from "./testing";

async function institutionRows(h: Harness) {
  const [rows] = await h.db.select({ n: count() }).from(institution);
  return rows?.n;
}

describe("registerInstitution", () => {
  it("registers an institution that its authorised person then sees pending verification", async () => {
    const h = await createHarness();
    const person = await h.seed.member();
    const actor = await h.signIn(person);

    const result = await h
      .as(actor)
      .registerInstitution(validRegistration({ name: "  Sunrise School " }));

    expect(result).toEqual({ ok: true, institutionId: expect.any(String) });
    expect(await h.as(actor).getMyInstitution()).toEqual({
      ok: true,
      institution: {
        id: result.ok ? result.institutionId : undefined,
        name: "Sunrise School",
        type: "school",
        address: "12 Lake Road, Sector 4",
        pinCode: "411001",
        city: "Pune",
        state: "Maharashtra",
        country: "India",
        contactEmail: "office@sunrise-school.example.test",
        contactPhone: "+919000000201",
        principalName: "Meera Kulkarni",
        principalEmail: "principal@sunrise-school.example.test",
        principalPhone: "+919000000202",
        expectedParticipants: 240,
        status: "pending_verification",
        statusReason: null,
        institutionCode: null,
        registeredAt: h.clock.now(),
        verifiedAt: null,
      },
    });
  });

  it("stores the principal's email and phone encrypted, never as written", async () => {
    const h = await createHarness();
    const { institutionId } = await registeredInstitution(h, {
      principalEmail: "Head.Teacher@Sunrise.example.test",
      principalPhone: "9000000202",
    });

    const [row] = await h.db
      .select()
      .from(institution)
      .where(eq(institution.id, institutionId));
    const stored = JSON.stringify(row).toLowerCase();

    expect(stored).not.toContain("head.teacher@sunrise.example.test");
    expect(stored).not.toContain("9000000202");
    expect(row?.principalEmailCiphertext).toMatch(/^v\d+:/);
    expect(row?.principalPhoneCiphertext).toMatch(/^v\d+:/);
  });

  it("records one audit entry with the status only", async () => {
    const h = await createHarness();
    const { person, institutionId } = await registeredInstitution(h);

    const entries = await h.db.select().from(auditLog);

    expect(entries).toEqual([
      expect.objectContaining({
        actorUserId: person.id,
        action: "institution.registered",
        entityType: "institution",
        entityId: institutionId,
        before: null,
        after: { status: "pending_verification" },
      }),
    ]);
  });

  it.each([
    ["a pin code starting with 0", { pinCode: "011001" }, "pinCode"],
    ["a five-digit pin code", { pinCode: "41100" }, "pinCode"],
    ["no participants", { expectedParticipants: 0 }, "expectedParticipants"],
    [
      "more than 100,000 participants",
      { expectedParticipants: 100_001 },
      "expectedParticipants",
    ],
    [
      "a fraction of a participant",
      { expectedParticipants: 12.5 },
      "expectedParticipants",
    ],
    [
      "a landline for the principal",
      { principalPhone: "020 2612 3456" },
      "principalPhone",
    ],
    [
      "a contact email without a domain",
      { contactEmail: "office@" },
      "contactEmail",
    ],
    ["an institution type FOA doesn't list", { type: "academy" }, "type"],
    ["a blank name", { name: "   " }, "name"],
  ] as const)(
    "refuses %s and stores nothing",
    async (_case, overrides, field) => {
      const h = await createHarness();
      const actor = await h.signIn(await h.seed.member());

      const result = await h
        .as(actor)
        .registerInstitution(validRegistration(overrides));

      expect(result).toEqual({
        ok: false,
        error: "invalid_input",
        fields: [field],
      });
      expect(await institutionRows(h)).toBe(0);
    }
  );

  it("refuses a second registration while the first is still open", async () => {
    const h = await createHarness();
    const { actor } = await registeredInstitution(h);

    expect(
      await h
        .as(actor)
        .registerInstitution(validRegistration({ name: "Another School" }))
    ).toEqual({ ok: false, error: "already_registered" });
    expect(await institutionRows(h)).toBe(1);
  });

  it("is for signed-in people: a visitor is refused and nothing is stored", async () => {
    const h = await createHarness();

    await expect(
      h.as(h.visitor()).registerInstitution(validRegistration())
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await institutionRows(h)).toBe(0);
  });
});

describe("getMyInstitution", () => {
  it("shows another member nothing of someone else's institution", async () => {
    const h = await createHarness();
    await registeredInstitution(h);
    const other = await h.signIn(await h.seed.member());

    expect(await h.as(other).getMyInstitution()).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();

    await expect(h.as(h.visitor()).getMyInstitution()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
