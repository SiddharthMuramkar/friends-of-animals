import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createPgWorld, type PgWorld } from "@/test/pg";
import {
  certificate,
  engagementMilestone,
  timelineEntry,
} from "../../db/schema";
import { istDate } from "./domain/hours";
let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});
it("serializes real concurrent daily logs, approvals and certificate requests", async () => {
  const person = await world.seed.member({
    email: world.uniqueEmail(),
    name: "Race Volunteer",
  });
  await world.seed.grant(person, {
    role: "volunteer",
    scope: { type: "global" },
  });
  const volunteer = world.as(await world.signedIn(person));
  const managerAccount = await world.seed.member({
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
  const task = await manager.createVolunteerTask({
    title: "Volunteer event",
    description: "Help with supplies",
  });
  if (!task.ok) throw Error("Cannot create task");
  const taskId = task.taskId;
  await manager.publishVolunteerTask({ taskId });
  await manager.assignVolunteerTask({ taskId, volunteerUserId: person.id });
  const input = { taskId, minutes: 1000, workedOn: istDate(world.clock.now()) };
  const logs = await world.sql.begin(async (blocker) => {
    await blocker`select id from "user" where id=${person.id} for no key update`;
    const first = volunteer.logVolunteerHours(input),
      second = volunteer.logVolunteerHours(input);
    first.catch(() => {});
    second.catch(() => {});
    await world.waitForLockWaiters(2);
    return { first, second };
  });
  const results = await Promise.all([logs.first, logs.second]);
  const logged = results.find((r) => r.ok);
  if (!logged?.ok) throw Error("No log won");
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results).toContainEqual({ ok: false, error: "day_limit_exceeded" });
  const entryId = logged.entryId;
  const approvals = await world.sql.begin(async (blocker) => {
    await blocker`select id from "user" where id=${person.id} for no key update`;
    const first = manager.approveVolunteerHours({ entryId }),
      second = manager.approveVolunteerHours({ entryId });
    first.catch(() => {});
    second.catch(() => {});
    await world.waitForLockWaiters(2);
    return { first, second };
  });
  expect(await Promise.all([approvals.first, approvals.second])).toEqual(
    expect.arrayContaining([
      { ok: true },
      { ok: false, error: "invalid_transition" },
    ])
  );
  expect(await volunteer.getMyVolunteerRecord()).toMatchObject({
    approvedMinutes: 1000,
  });
  expect(
    await world.db
      .select()
      .from(engagementMilestone)
      .where(
        and(
          eq(engagementMilestone.subjectUserId, person.id),
          eq(engagementMilestone.kind, "volunteer")
        )
      )
  ).toHaveLength(1);
  expect(
    await world.db
      .select()
      .from(timelineEntry)
      .where(
        and(
          eq(timelineEntry.subjectUserId, person.id),
          eq(timelineEntry.kind, "volunteer.hours_approved")
        )
      )
  ).toHaveLength(1);
  const requests = await world.sql.begin(async (blocker) => {
    await blocker`select id from "user" where id=${person.id} for no key update`;
    const first = volunteer.requestVolunteerCertificate(),
      second = volunteer.requestVolunteerCertificate();
    first.catch(() => {});
    second.catch(() => {});
    await world.waitForLockWaiters(2);
    return { first, second };
  });
  const [one, two] = await Promise.all([requests.first, requests.second]);
  expect(one).toMatchObject({ ok: true, approvedMinutes: 1000 });
  expect(two).toEqual(one);
  expect(
    await world.db
      .select()
      .from(certificate)
      .where(eq(certificate.recipientUserId, person.id))
  ).toHaveLength(1);
});
