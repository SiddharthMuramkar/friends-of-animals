import { count, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { auditLog } from "@/server/db/schema";
import { createMigratedClient } from "@/test/db";
import { createHarness, type Harness } from "@/test/harness";

import { recordAudit } from "./record";

async function auditRows(h: Harness) {
  const [row] = await h.db.select({ rows: count() }).from(auditLog);
  return row?.rows;
}

/**
 * The trigger's refusal. Drizzle wraps the driver's error in its own, whose
 * message is the failed query, and keeps what Postgres said as `cause`.
 */
function refusedWith(operation: string) {
  return {
    cause: {
      message: `audit_log is append-only: ${operation} is not allowed`,
    },
  };
}

/** One audit row, written the way a use case writes it. */
async function recordOne(h: Harness) {
  const member = await h.seed.member();
  const actor = await h.signIn(member, {
    ip: "198.51.100.7",
    userAgent: "Audit test browser",
  });
  await recordAudit(
    h.db,
    { clock: h.clock, actor },
    {
      action: "role.granted",
      entity: { type: "user", id: member.id },
      before: [],
      after: [{ role: "judge", scope: { type: "global" } }],
      actorRole: "super_admin",
    }
  );
  return { member };
}

describe("recordAudit", () => {
  it("records who did what to which record, when and from where", async () => {
    const h = await createHarness();
    const { member } = await recordOne(h);

    expect(await h.db.select().from(auditLog)).toEqual([
      {
        id: expect.any(String),
        occurredAt: h.clock.now(),
        actorKind: "user",
        actorUserId: member.id,
        actorProcess: null,
        actorRole: "super_admin",
        action: "role.granted",
        entityType: "user",
        entityId: member.id,
        before: [],
        after: [{ role: "judge", scope: { type: "global" } }],
        ip: "198.51.100.7",
        userAgent: "Audit test browser",
      },
    ]);
  });

  it("records the platform itself as the actor, with no IP", async () => {
    const h = await createHarness();
    const member = await h.seed.member();

    await recordAudit(
      h.db,
      { clock: h.clock, actor: { kind: "system", process: "cli" } },
      {
        action: "role.granted",
        entity: { type: "user", id: member.id },
        before: [],
        after: [{ role: "super_admin", scope: { type: "global" } }],
        actorRole: null,
      }
    );

    expect(await h.db.select().from(auditLog)).toMatchObject([
      {
        actorKind: "system",
        actorUserId: null,
        actorProcess: "cli",
        actorRole: null,
        ip: null,
        userAgent: null,
      },
    ]);
  });
});

describe("the audit log", () => {
  it("refuses an update, even from the database owner", async () => {
    const h = await createHarness();
    await recordOne(h);

    await expect(
      h.db.execute(sql`update audit_log set action = 'role.revoked'`)
    ).rejects.toMatchObject(refusedWith("UPDATE"));
    expect(
      await h.db.select({ action: auditLog.action }).from(auditLog)
    ).toEqual([{ action: "role.granted" }]);
  });

  it("refuses a delete", async () => {
    const h = await createHarness();
    await recordOne(h);

    await expect(
      h.db.execute(sql`delete from audit_log`)
    ).rejects.toMatchObject(refusedWith("DELETE"));
    expect(await auditRows(h)).toBe(1);
  });

  it("refuses a truncate", async () => {
    const h = await createHarness();
    await recordOne(h);

    await expect(h.db.execute(sql`truncate audit_log`)).rejects.toMatchObject(
      refusedWith("TRUNCATE")
    );
    expect(await auditRows(h)).toBe(1);
  });
});

describe("an app role on a deployed database", () => {
  it("can add and read audit entries but holds no right to update, delete or truncate them", async () => {
    // How a deployed database hands its app role rights on every new
    // table: default privileges, set up before the migrations run.
    const client = await createMigratedClient({
      before: (empty) =>
        empty.exec(`
          create role foa_app_test;
          grant usage on schema public to foa_app_test;
          alter default privileges in schema public
            grant select, insert, update, delete, truncate on tables to foa_app_test;
        `),
    });
    onTestFinished(() => client.close());

    await client.exec("set role foa_app_test");
    await client.query(`
      insert into audit_log
        (id, occurred_at, actor_kind, actor_process, action, entity_type, entity_id)
      values
        ('01938a00-0000-7000-8000-00000000e001', now(), 'system', 'cli',
         'role.granted', 'user', '01938a00-0000-7000-8000-000000000101')
    `);
    const { rows } = await client.query<{ n: number }>(
      "select count(*)::int as n from audit_log"
    );
    expect(rows).toEqual([{ n: 1 }]);

    for (const statement of [
      "update audit_log set action = 'role.revoked'",
      "delete from audit_log",
      "truncate audit_log",
    ]) {
      await expect(client.query(statement)).rejects.toThrow(
        "permission denied for table audit_log"
      );
    }
  });
});
