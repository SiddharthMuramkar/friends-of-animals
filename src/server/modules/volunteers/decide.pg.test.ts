import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { userRole, volunteerApplication } from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { applicationInput, bornYearsAgo, openVolunteering } from "./testing";

// Races on one person's volunteering (#123), on a real Postgres: what
// PGlite's single connection can't show.

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

function volunteerWorld() {
  return { db: world.db, clock: world.clock, settings: world.deps.settings };
}

it("keeps one open application when a member applies twice at once", async () => {
  const declarations = await openVolunteering(volunteerWorld());
  const applicant = await world.seed.member({
    name: "Priya Nair",
    email: world.uniqueEmail(),
  });
  const priya = world.as(await world.signedIn(applicant));
  const input = applicationInput(declarations, {
    dateOfBirth: bornYearsAgo(volunteerWorld(), 30),
  });

  const results = await world.sql.begin(async (blocker) => {
    // Hold the applicant's row, so both applications queue behind it.
    await blocker`select 1 from "user" where id = ${applicant.id} for update`;
    const first = priya.applyToVolunteer(input);
    first.catch(() => {});
    const second = priya.applyToVolunteer(input);
    second.catch(() => {});
    await world.waitForLockWaiters(2);
    return [first, second];
  });

  const settled = await Promise.all(results);
  expect(settled.filter((result) => result.ok)).toHaveLength(1);
  expect(settled).toContainEqual({ ok: false, error: "application_open" });
  const rows = await world.db
    .select({ id: volunteerApplication.id })
    .from(volunteerApplication)
    .where(eq(volunteerApplication.applicantUserId, applicant.id));
  expect(rows).toHaveLength(1);
});

it("lets either an approval or a withdrawal win, never both, and grants the role only with the approval", async () => {
  const declarations = await openVolunteering(volunteerWorld());
  const applicant = await world.seed.member({
    name: "Ravi Kumar",
    email: world.uniqueEmail(),
  });
  const ravi = world.as(await world.signedIn(applicant));
  const applied = await ravi.applyToVolunteer(
    applicationInput(declarations, {
      dateOfBirth: bornYearsAgo(volunteerWorld(), 40),
    })
  );
  if (!applied.ok) throw new Error(applied.error);
  const managerAccount = await world.seed.member({
    name: "Neha Kapoor",
    email: world.uniqueEmail(),
  });
  await world.seed.grant(managerAccount, {
    role: "community_manager",
    scope: { type: "global" },
  });
  await world.seed.authenticator(managerAccount);
  const manager = world.as(
    await world.signedIn(managerAccount, { secondFactor: true })
  );
  const { applicationId } = applied;

  const racing = await world.sql.begin(async (blocker) => {
    // Hold the application, so the decision and the withdrawal queue on it.
    await blocker`select 1 from volunteer_application where id = ${applicationId} for update`;
    const approving = manager.approveVolunteer({ applicationId });
    approving.catch(() => {});
    const withdrawing = ravi.withdrawVolunteerApplication({ applicationId });
    withdrawing.catch(() => {});
    await world.waitForLockWaiters(2);
    return [approving, withdrawing] as const;
  });

  const [approved, withdrawn] = await Promise.all(racing);
  expect([approved.ok, withdrawn.ok].filter(Boolean)).toHaveLength(1);
  const [row] = await world.db
    .select({ status: volunteerApplication.status })
    .from(volunteerApplication)
    .where(eq(volunteerApplication.id, applicationId));
  const grants = await world.db
    .select({ id: userRole.id })
    .from(userRole)
    .where(
      and(eq(userRole.userId, applicant.id), eq(userRole.role, "volunteer"))
    );
  if (approved.ok) {
    expect(row?.status).toBe("approved");
    expect(withdrawn).toEqual({ ok: false, error: "invalid_transition" });
    expect(grants).toHaveLength(1);
  } else {
    expect(row?.status).toBe("withdrawn");
    expect(approved).toEqual({ ok: false, error: "invalid_transition" });
    expect(grants).toEqual([]);
  }
});
