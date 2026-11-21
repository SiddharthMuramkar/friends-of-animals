import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { registeredInstitution, signedInStaff } from "./testing";

describe("listInstitutions", () => {
  it("lists one status, oldest registration first, for staff to work through", async () => {
    const h = await createHarness();
    const start = h.clock.now();
    const first = await registeredInstitution(h, { name: "First School" });
    h.clock.advance({ hours: 2 });
    const second = await registeredInstitution(h, {
      name: "Second College",
      type: "college",
      city: "Nashik",
    });
    h.clock.advance({ hours: 2 });
    const third = await registeredInstitution(h, { name: "Third School" });
    const staff = await signedInStaff(h);
    await h.as(staff).decideInstitution({
      institutionId: third.institutionId,
      decision: "reject",
      reason: "Not a registered school",
    });

    const pending = await h
      .as(staff)
      .listInstitutions({ status: "pending_verification" });

    expect(pending).toEqual({
      ok: true,
      institutions: [
        expect.objectContaining({
          id: first.institutionId,
          name: "First School",
          status: "pending_verification",
        }),
        {
          id: second.institutionId,
          name: "Second College",
          type: "college",
          city: "Nashik",
          state: "Maharashtra",
          status: "pending_verification",
          institutionCode: null,
          registeredAt: new Date(start.getTime() + 2 * 3600_000),
        },
      ],
    });
    expect(await h.as(staff).listInstitutions({})).toMatchObject({
      institutions: [
        { name: "First School" },
        { name: "Second College" },
        { name: "Third School", status: "rejected" },
      ],
    });
  });

  it("is for FOA admins: a member and an institution's admin are refused", async () => {
    const h = await createHarness();
    const { actor, institutionId } = await registeredInstitution(h);
    const staff = await signedInStaff(h, "super_admin");
    await h.as(staff).decideInstitution({
      institutionId,
      decision: "verify",
      reason: "Documents match",
    });
    const member = await h.signIn(await h.seed.member());

    expect(await h.as(staff).listInstitutions({})).toMatchObject({ ok: true });
    for (const refused of [member, actor]) {
      await expect(h.as(refused).listInstitutions({})).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });
});

describe("getInstitutionForReview", () => {
  it("shows staff every detail, with the principal's contact readable and who registered it", async () => {
    const h = await createHarness();
    const { person, institutionId } = await registeredInstitution(h);
    const staff = await signedInStaff(h);

    expect(
      await h.as(staff).getInstitutionForReview({ institutionId })
    ).toEqual({
      ok: true,
      institution: expect.objectContaining({
        id: institutionId,
        name: "Sunrise Public School",
        principalEmail: "principal@sunrise-school.example.test",
        principalPhone: "+919000000202",
        status: "pending_verification",
        authorisedPerson: {
          id: person.id,
          name: person.name,
          email: person.email,
        },
      }),
    });
  });

  it("answers not_found for an institution that doesn't exist", async () => {
    const h = await createHarness();
    const staff = await signedInStaff(h);

    expect(
      await h.as(staff).getInstitutionForReview({
        institutionId: "01938a00-0000-7000-8000-00000000dead",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("is for FOA admins: the authorised person and a member are refused", async () => {
    const h = await createHarness();
    const { actor, institutionId } = await registeredInstitution(h);
    const member = await h.signIn(await h.seed.member());

    for (const refused of [member, actor]) {
      await expect(
        h.as(refused).getInstitutionForReview({ institutionId })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
