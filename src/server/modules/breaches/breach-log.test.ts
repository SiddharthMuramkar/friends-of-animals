import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { breachTimelineEvent } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import {
  breachAudit,
  breachDetails,
  recordedBreach,
  staffActor,
  storedBreach,
  timelineKinds,
  userIdOf,
} from "./testing";

const IMPACT_WORDS = "Names and schools of three entrants";

describe("recordBreach", () => {
  it("records an open breach and audits it without its title or impact", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const details = breachDetails(h);

    const result = await h.as(admin).recordBreach(details);

    expect(result).toEqual({ ok: true, id: expect.any(String) });
    const id = result.ok ? result.id : "";
    expect(await breachAudit(h)).toEqual([
      expect.objectContaining({
        actorKind: "user",
        actorUserId: userIdOf(admin),
        actorRole: "super_admin",
        action: "breach.recorded",
        entityType: "breach",
        entityId: id,
        before: null,
        after: {
          status: "open",
          severity: "high",
          personalDataInvolved: true,
          minorsAffected: true,
          affectedCount: 3,
          containedAt: null,
          principalsNotifiedAt: null,
          authorityNotifiedAt: null,
        },
      }),
    ]);
  });

  it("is led by whoever recorded it, keeps when FOA became aware, and starts its timeline", async () => {
    const h = await createHarness();
    const staff = await staffActor(h, "staff_admin");
    const details = breachDetails(h);

    const id = await recordedBreach(h, staff);

    const row = await storedBreach(h, id);
    expect(row).toMatchObject({
      status: "open",
      leadUserId: userIdOf(staff),
      awareAt: details.awareAt,
      title: details.title,
      containedAt: null,
      closedAt: null,
    });
    expect(await timelineKinds(h, id)).toEqual(["recorded"]);
  });

  it("stores the impact encrypted", async () => {
    const h = await createHarness();
    const id = await recordedBreach(h, await staffActor(h, "super_admin"));

    const raw = await h.db.execute(
      sql`SELECT impact_ciphertext FROM breach_record WHERE id = ${id}`
    );

    expect(JSON.stringify(raw)).not.toContain(IMPACT_WORDS);
  });

  it("refuses a time of awareness after now, and writes nothing", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");

    const result = await h.as(admin).recordBreach(
      breachDetails(h, {
        awareAt: new Date(h.clock.now().getTime() + 60_000),
      })
    );

    expect(result).toEqual({ ok: false, error: "aware_in_future" });
    expect(await breachAudit(h)).toEqual([]);
    expect(await h.db.select().from(breachTimelineEvent)).toEqual([]);
  });

  it("names the fields it can't accept", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");

    const result = await h
      .as(admin)
      .recordBreach(breachDetails(h, { title: " ", affectedCount: -1 }));

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["title", "affectedCount"],
    });
    expect(await breachAudit(h)).toEqual([]);
  });
});

describe("updateBreach", () => {
  it("corrects the record, adds to its timeline and audits the fields that changed", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const id = await recordedBreach(h, admin);

    const result = await h.as(admin).updateBreach({
      breachId: id,
      title: "Entry export sent to the wrong school",
      severity: "critical",
      affectedCount: 40,
    });

    expect(result).toEqual({ ok: true, changed: true });
    expect(await storedBreach(h, id)).toMatchObject({
      title: "Entry export sent to the wrong school",
      severity: "critical",
      affectedCount: 40,
    });
    expect(await timelineKinds(h, id)).toEqual(["recorded", "updated"]);
    const [, updated] = await breachAudit(h, id);
    expect(updated).toMatchObject({
      action: "breach.updated",
      before: { severity: "high", affectedCount: 3 },
      after: {
        severity: "critical",
        affectedCount: 40,
        changedFields: ["title", "severity", "affectedCount"],
      },
    });
    expect(JSON.stringify(updated)).not.toContain("wrong school");
  });

  it("changes and records nothing when nothing differs", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const id = await recordedBreach(h, admin);

    const result = await h
      .as(admin)
      .updateBreach({ breachId: id, severity: "high" });

    expect(result).toEqual({ ok: true, changed: false });
    expect(await timelineKinds(h, id)).toEqual(["recorded"]);
    expect(await breachAudit(h, id)).toHaveLength(1);
  });

  it("finds no breach by an unknown id", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");

    const result = await h.as(admin).updateBreach({
      breachId: "01938a00-0000-7000-8000-00000000dead",
      severity: "low",
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("addBreachTimelineEvent", () => {
  it("adds an encrypted note, audited without its words", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "staff_admin");
    const id = await recordedBreach(h, admin);

    const result = await h.as(admin).addBreachTimelineEvent({
      breachId: id,
      note: "Called the other school; they deleted the export.",
    });

    expect(result).toEqual({ ok: true });
    expect(await timelineKinds(h, id)).toEqual(["recorded", "note"]);
    const raw = await h.db.execute(
      sql`SELECT note_ciphertext FROM breach_timeline_event WHERE breach_id = ${id}`
    );
    expect(JSON.stringify(raw)).not.toContain("deleted the export");
    const audit = await breachAudit(h, id);
    expect(audit.map((row) => row.action)).toEqual([
      "breach.recorded",
      "breach.timeline_entry_added",
    ]);
    expect(JSON.stringify(audit)).not.toContain("deleted the export");
  });

  it("refuses an empty note", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "staff_admin");
    const id = await recordedBreach(h, admin);

    const result = await h
      .as(admin)
      .addBreachTimelineEvent({ breachId: id, note: "   " });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["note"],
    });
    expect(await timelineKinds(h, id)).toEqual(["recorded"]);
  });
});

describe("containBreach", () => {
  it("contains an open breach, stamping the time", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const id = await recordedBreach(h, admin);
    h.clock.advance({ minutes: 30 });

    const result = await h.as(admin).containBreach({ breachId: id });

    expect(result).toEqual({ ok: true, status: "contained" });
    expect(await storedBreach(h, id)).toMatchObject({
      status: "contained",
      containedAt: h.clock.now(),
    });
    expect(await timelineKinds(h, id)).toEqual(["recorded", "contained"]);
    const [, contained] = await breachAudit(h, id);
    expect(contained).toMatchObject({
      action: "breach.contained",
      before: { status: "open", containedAt: null },
      after: {
        status: "contained",
        containedAt: h.clock.now().toISOString(),
      },
    });
  });

  it("refuses to contain twice, and writes nothing", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const id = await recordedBreach(h, admin);
    await h.as(admin).containBreach({ breachId: id });

    const result = await h.as(admin).containBreach({ breachId: id });

    expect(result).toEqual({ ok: false, error: "already_contained" });
    expect(await timelineKinds(h, id)).toEqual(["recorded", "contained"]);
    expect(await breachAudit(h, id)).toHaveLength(2);
  });
});

describe("closeBreach", () => {
  it("closes a contained breach that needed no notice, with the reason in its timeline", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const id = await recordedBreach(h, admin);
    await h.as(admin).containBreach({ breachId: id });

    const result = await h.as(admin).closeBreach({
      breachId: id,
      reason: "The export never left FOA's own mailbox.",
    });

    expect(result).toEqual({ ok: true, status: "closed" });
    expect(await storedBreach(h, id)).toMatchObject({
      status: "closed",
      closedAt: h.clock.now(),
    });
    expect(await timelineKinds(h, id)).toEqual([
      "recorded",
      "contained",
      "closed",
    ]);
    const audit = await breachAudit(h, id);
    expect(audit.at(-1)).toMatchObject({
      action: "breach.closed",
      after: { status: "closed" },
    });
    expect(JSON.stringify(audit)).not.toContain("mailbox");
  });

  it("asks for a reason to close a breach no one was told of", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const id = await recordedBreach(h, admin);
    await h.as(admin).containBreach({ breachId: id });

    const result = await h.as(admin).closeBreach({ breachId: id });

    expect(result).toEqual({ ok: false, error: "reason_required" });
    expect((await storedBreach(h, id)).status).toBe("contained");
    expect(await breachAudit(h, id)).toHaveLength(2);
  });

  it("never closes an open breach", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const id = await recordedBreach(h, admin);

    const result = await h
      .as(admin)
      .closeBreach({ breachId: id, reason: "Nothing happened." });

    expect(result).toEqual({ ok: false, error: "transition_not_allowed" });
    expect(await timelineKinds(h, id)).toEqual(["recorded"]);
    expect(await breachAudit(h, id)).toHaveLength(1);
  });

  it("leaves a closed breach as it is: no change, no note, no record", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const id = await recordedBreach(h, admin);
    await h.as(admin).containBreach({ breachId: id });
    await h.as(admin).closeBreach({ breachId: id, reason: "No data left." });
    const before = await breachAudit(h, id);

    expect(await h.as(admin).containBreach({ breachId: id })).toEqual({
      ok: false,
      error: "breach_closed",
    });
    expect(
      await h.as(admin).closeBreach({ breachId: id, reason: "Again." })
    ).toEqual({ ok: false, error: "breach_closed" });
    expect(
      await h.as(admin).updateBreach({ breachId: id, severity: "low" })
    ).toEqual({ ok: false, error: "breach_closed" });

    expect(await breachAudit(h, id)).toEqual(before);
    expect((await storedBreach(h, id)).severity).toBe("high");
  });
});

describe("the timeline", () => {
  it("can't be changed or emptied, even with raw SQL", async () => {
    const h = await createHarness();
    const id = await recordedBreach(h, await staffActor(h, "super_admin"));

    await expect(
      h.db.execute(
        sql`UPDATE breach_timeline_event SET kind = 'note' WHERE breach_id = ${id}`
      )
    ).rejects.toThrow();
    await expect(
      h.db.execute(
        sql`DELETE FROM breach_timeline_event WHERE breach_id = ${id}`
      )
    ).rejects.toThrow();
    await expect(
      h.db.execute(sql`TRUNCATE breach_timeline_event`)
    ).rejects.toThrow();
    expect(await timelineKinds(h, id)).toEqual(["recorded"]);
  });

  it("goes with its breach when the breach itself is deleted (retention)", async () => {
    const h = await createHarness();
    const id = await recordedBreach(h, await staffActor(h, "super_admin"));

    await h.db.execute(sql`DELETE FROM breach_record WHERE id = ${id}`);

    expect(
      await h.db
        .select()
        .from(breachTimelineEvent)
        .where(eq(breachTimelineEvent.breachId, id))
    ).toEqual([]);
  });
});
