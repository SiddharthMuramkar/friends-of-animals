import { expect, it } from "vitest";
import { asc } from "drizzle-orm";
import {
  ambassadorApplication,
  communityMember,
  engagementMilestone,
  timelineEntry,
  outbox,
} from "../db/schema";
import { createHarness } from "@/test/harness";
import { seedAmbassadors } from "./ambassadors";
import { SEED_ACCOUNTS } from "./accounts";
import { SEED_VOLUNTEERS } from "./volunteers";
import { staffActor } from "../modules/volunteers/testing";

it("seeds an eligible adult finalist and a genuine service volunteer's pending application without replaying a decision", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const finalist = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));
  const volunteer = h.as(await h.signIn(SEED_VOLUNTEERS.approved));
  const manager = h.as(await staffActor(h, "community_manager"));
  expect((await finalist.getMyAmbassador()).eligibility.eligible).toBe(true);
  const pending = (await volunteer.getMyAmbassador()).application;
  expect(pending).toMatchObject({ status: "submitted" });
  if (!pending) throw Error("Preview application missing");
  expect(
    await manager.decideAmbassador({
      applicationId: pending.id,
      decision: "decline",
      reason: "Apply later.",
    })
  ).toEqual({ ok: true });
  const snapshot = async () => ({
    applications: await h.db
      .select()
      .from(ambassadorApplication)
      .orderBy(asc(ambassadorApplication.id)),
    members: await h.db
      .select()
      .from(communityMember)
      .orderBy(asc(communityMember.id)),
    milestones: await h.db
      .select()
      .from(engagementMilestone)
      .orderBy(asc(engagementMilestone.id)),
    timeline: await h.db
      .select()
      .from(timelineEntry)
      .orderBy(asc(timelineEntry.id)),
    outbox: await h.db.select().from(outbox).orderBy(asc(outbox.id)),
  });
  const first = await snapshot();
  await seedAmbassadors(h.deps);
  expect(await snapshot()).toEqual(first);
  expect((await volunteer.getMyAmbassador()).application).toMatchObject({
    id: pending.id,
    status: "declined",
    declineReason: "Apply later.",
  });
});
