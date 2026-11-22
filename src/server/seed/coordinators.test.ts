import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  institution,
  institutionInvitation,
  userRole,
} from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_COORDINATORS } from "./coordinators";
import { SEED_SCOPES } from "./scopes";

describe("the coordinators seed", () => {
  it("gives every seeded verified institution a coordinator and a waiting invitation", async () => {
    const h = await createHarness();
    await h.seed.preview();

    const verified = await h.db
      .select({ id: institution.id })
      .from(institution)
      .where(eq(institution.status, "verified"));
    expect(verified.map((row) => row.id)).toContain(SEED_SCOPES.institution.id);
    for (const { id } of verified) {
      const coordinators = await h.db
        .select()
        .from(userRole)
        .where(eq(userRole.scopeId, id));
      expect(
        coordinators.filter((row) => row.role === "institution_coordinator")
      ).not.toHaveLength(0);
      const waiting = await h.db
        .select()
        .from(institutionInvitation)
        .where(eq(institutionInvitation.institutionId, id));
      expect(waiting.filter((row) => row.status === "pending")).toHaveLength(1);
    }
  });

  it("lets the seeded authorised person see them on the coordinators list", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const principal = await h.signIn(SEED_COORDINATORS.principal);

    const list = await h
      .as(principal)
      .listCoordinators({ institutionId: SEED_SCOPES.institution.id });

    expect(list).toMatchObject({
      ok: true,
      coordinators: [{ userId: SEED_COORDINATORS.coordinator.id }],
      invitations: [
        {
          id: SEED_COORDINATORS.invitation.id,
          status: "pending",
          maskedIdentifier: "i***@example.test",
        },
      ],
    });
  });

  it("changes nothing when it runs again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const rows = () =>
      Promise.all([
        h.db.select().from(institution).orderBy(asc(institution.id)),
        h.db
          .select()
          .from(institutionInvitation)
          .orderBy(asc(institutionInvitation.id)),
        h.db.select().from(userRole).orderBy(asc(userRole.id)),
      ]);
    const first = await rows();

    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await rows()).toEqual(first);
  });
});
