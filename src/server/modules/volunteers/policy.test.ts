import { describe, expect, it } from "vitest";

import type { Role } from "@/server/access";
import type { Actor } from "@/server/actor";
import { createHarness, type Harness } from "@/test/harness";

import {
  adultApplication,
  applicationRow,
  openVolunteering,
  staffActor,
  volunteerAudit,
  volunteerEvents,
} from "./testing";

// #123 AC "Every new use case has authorization tests". The guardian's and
// the applicant's own use cases are tested where they act
// (./apply.test.ts, ./guardian-decision.test.ts); here, the community
// team's. Community managers and super admins with their second factor
// may review and decide; everyone else is refused before any work, and a
// refusal writes nothing.

type UseCases = ReturnType<Harness["as"]>;

const CALLS: Record<
  string,
  (use: UseCases, applicationId: string) => Promise<unknown>
> = {
  listVolunteerApplications: (use) => use.listVolunteerApplications(),
  getVolunteerApplication: (use, applicationId) =>
    use.getVolunteerApplication({ applicationId }),
  declineVolunteer: (use, applicationId) =>
    use.declineVolunteer({ applicationId, reason: "Not this season." }),
  approveVolunteer: (use, applicationId) =>
    use.approveVolunteer({ applicationId }),
};

const DENIED_ROLES: Role[] = [
  "staff_admin",
  "content_manager",
  "safeguarding_lead",
  "volunteer",
];

async function deniedActors(h: Harness): Promise<[string, Actor][]> {
  const actors: [string, Actor][] = [];
  for (const role of DENIED_ROLES) {
    actors.push([role, await staffActor(h, role)]);
  }
  actors.push(["member", await h.signIn(await h.seed.member())]);
  actors.push(["visitor", h.visitor()]);
  return actors;
}

describe("who may review volunteer applications", () => {
  it.each(["community_manager", "super_admin"] as const)(
    "lets a %s with their second factor run every review use case",
    async (role) => {
      const h = await createHarness();
      const declarations = await openVolunteering(h);
      const staff = await staffActor(h, role);

      for (const [name, call] of Object.entries(CALLS)) {
        const { applicationId } = await adultApplication(h, declarations, {
          name: `Applicant for ${name}`,
          email: `${name.toLowerCase()}@example.test`,
        });
        await expect(
          call(h.as(staff), applicationId),
          name
        ).resolves.toMatchObject({ ok: true });
      }
    }
  );

  it("refuses everyone else before any work, writing nothing", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { applicationId } = await adultApplication(h, declarations);
    const auditBefore = await volunteerAudit(h);
    const eventsBefore = await volunteerEvents(h);

    for (const [who, actor] of await deniedActors(h)) {
      for (const [name, call] of Object.entries(CALLS)) {
        await expect(
          call(h.as(actor), applicationId),
          `${who} → ${name}`
        ).rejects.toMatchObject({ code: "forbidden" });
      }
    }

    expect(await applicationRow(h, applicationId)).toMatchObject({
      status: "submitted",
      decidedAt: null,
    });
    expect(await volunteerAudit(h)).toEqual(auditBefore);
    expect(await volunteerEvents(h)).toEqual(eventsBefore);
  });

  it("asks a community manager short of this session's second factor for it", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { applicationId } = await adultApplication(h, declarations);
    const account = await h.seed.member();
    await h.seed.grant(account, {
      role: "community_manager",
      scope: { type: "global" },
    });
    await h.seed.authenticator(account);
    const manager = await h.signIn(account, undefined, {
      secondFactor: false,
    });

    for (const [name, call] of Object.entries(CALLS)) {
      await expect(
        call(h.as(manager), applicationId),
        name
      ).rejects.toMatchObject({
        // Approving asks for a fresh one, which this session never had.
        code:
          name === "approveVolunteer"
            ? "step_up_required"
            : "second_factor_required",
      });
    }
  });
});

describe("who may apply", () => {
  it("lets any signed-in member apply and read their own, and no visitor", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await adultApplication(h, declarations);

    expect(await h.as(priya.actor).myVolunteerApplication()).toMatchObject({
      application: { id: priya.applicationId },
    });
    expect(
      await h.as(priya.actor).acceptVolunteerDeclarations({
        safeguardingDocumentId: declarations.safeguarding,
        conductDocumentId: declarations.conduct,
      })
    ).toEqual({ ok: true, changed: false });
    await expect(
      h.as(h.visitor()).acceptVolunteerDeclarations({
        safeguardingDocumentId: declarations.safeguarding,
        conductDocumentId: declarations.conduct,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    // Another member sees only their own: none.
    const other = await h.signIn(await h.seed.member());
    expect((await h.as(other).myVolunteerApplication()).application).toBeNull();
    expect(
      await h.as(other).acceptVolunteerDeclarations({
        safeguardingDocumentId: declarations.safeguarding,
        conductDocumentId: declarations.conduct,
      })
    ).toEqual({ ok: false, error: "no_open_application" });
  });
});
