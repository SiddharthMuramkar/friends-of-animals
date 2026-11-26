import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness } from "@/test/harness";
import {
  volunteerTask,
  volunteerTaskAssignment,
  volunteerHoursEntry,
  certificate,
  engagementMilestone,
} from "../db/schema";
import { seedVolunteers } from "./volunteers";
import { seedVolunteerWork } from "./volunteer-work";
import { openVolunteering } from "../modules/volunteers/testing";
it("seeds every task status, all hour outcomes, one actual service certificate and milestone without duplicating them", async () => {
  const h = await createHarness();
  await openVolunteering(h);
  const deps = {
    db: h.db,
    clock: h.clock,
    cipher: h.deps.cipher,
    blindIndex: h.deps.blindIndex,
    auth: h.deps.auth,
  };
  await seedVolunteers(deps);
  await seedVolunteerWork(deps);
  const snapshot = async () => ({
    tasks: await h.db.select().from(volunteerTask),
    assignments: await h.db.select().from(volunteerTaskAssignment),
    hours: await h.db.select().from(volunteerHoursEntry),
    certificates: await h.db.select().from(certificate),
    milestones: await h.db
      .select()
      .from(engagementMilestone)
      .where(eq(engagementMilestone.kind, "volunteer")),
  });
  const first = await snapshot();
  expect(first.tasks.map((t) => t.status).sort()).toEqual([
    "assigned",
    "cancelled",
    "done",
    "draft",
    "in_progress",
    "open",
  ]);
  expect(first.hours.map((h) => h.status).sort()).toEqual([
    "approved",
    "rejected",
    "submitted",
  ]);
  expect(first.certificates).toMatchObject([
    { type: "volunteer_service", approvedMinutesSnapshot: 145 },
  ]);
  expect(first.milestones).toHaveLength(1);
  h.clock.advance({ days: 1 });
  await seedVolunteerWork(deps);
  expect(await snapshot()).toEqual(first);
});
