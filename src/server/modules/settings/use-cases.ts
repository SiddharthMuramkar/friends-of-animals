// The settings use cases (#62), for a super admin:
//
//   listSettings()               → every setting, its value and last change
//   changeSetting({ key, value }) → stores the value and audits the change
//
// A change runs in one transaction: it locks the acting user's row and
// checks them again (so a revoke of their role that commits meanwhile
// counts), then locks the setting's row, so concurrent changes queue and
// each audit entry's before and after are exact.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { setting, user } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { isSettingKey, SETTINGS } from "./catalogue";
import type { SettingInput } from "./definition";
import {
  decideSettingChange,
  resolveAllSettings,
  resolveSetting,
  type ResolvedSetting,
  type SettingValueProblem,
} from "./values";

/** What the settings use cases use: the database, the clock and the actor. */
export type SettingsContext = Pick<UseCaseContext, "db" | "clock" | "actor">;

/** One setting as the settings screen shows it. */
export type SettingView = ResolvedSetting & {
  input: SettingInput;
  /** When someone last stored a value; null while none is stored. */
  updatedAt: Date | null;
  /** Who stored it; null for seed data or once their account is gone. */
  updatedBy: { id: string; name: string } | null;
};

/** Every setting, in catalogue order. */
export async function listSettings(
  ctx: SettingsContext
): Promise<SettingView[]> {
  await authorize(ctx, "setting.view");
  const rows = await ctx.db
    .select({
      key: setting.key,
      value: setting.value,
      updatedAt: setting.updatedAt,
      updatedById: user.id,
      updatedByName: user.name,
    })
    .from(setting)
    .leftJoin(user, eq(user.id, setting.updatedByUserId));
  const byKey = new Map(rows.map((row) => [row.key, row] as const));
  return resolveAllSettings(rows).map((resolved) => {
    const row = byKey.get(resolved.key);
    return {
      ...resolved,
      input: SETTINGS[resolved.key].input,
      updatedAt: row?.updatedAt ?? null,
      updatedBy:
        row?.updatedById && row.updatedByName !== null
          ? { id: row.updatedById, name: row.updatedByName }
          : null,
    };
  });
}

export type ChangeSettingInput = { key: string; value: unknown };

export type ChangeSettingResult =
  /** `changed` is false when the value already applied: nothing stored. */
  | { ok: true; changed: boolean }
  | { ok: false; error: "unknown_setting" }
  | { ok: false; error: "invalid_value"; problem: SettingValueProblem };

/**
 * Locks the acting user's row until the transaction ends, then checks
 * them again. A revoke of their role locks the same row, so it either
 * commits first and this check refuses, or waits for this change.
 */
async function authorizeIn(tx: AppDb, ctx: SettingsContext) {
  if (ctx.actor.kind === "user") {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ctx.actor.userId))
      .for("share");
  }
  return authorize(
    { db: tx, clock: ctx.clock, actor: ctx.actor },
    "setting.change"
  );
}

/**
 * Sets `key` to `value`, checked against the setting's schema, and records
 * the change in the audit log. Submitting the value that already applies
 * stores and records nothing, unless the stored value no longer passes the
 * schema: then the submitted value replaces it.
 */
export async function changeSetting(
  ctx: SettingsContext,
  input: ChangeSettingInput
): Promise<ChangeSettingResult> {
  await authorize(ctx, "setting.change");
  const { key } = input;
  if (!isSettingKey(key)) return { ok: false, error: "unknown_setting" };
  return ctx.db.transaction(async (tx) => {
    const { role: actorRole } = await authorizeIn(tx, ctx);
    const now = ctx.clock.now();
    const updatedByUserId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    // Twice at most: if another change stores this setting's first value
    // between the read and the insert, the insert does nothing, and the
    // second pass reads that value, locked.
    for (let pass = 0; pass < 2; pass++) {
      const [row] = await tx
        .select({ value: setting.value })
        .from(setting)
        .where(eq(setting.key, key))
        .for("update");
      const decision = decideSettingChange(
        resolveSetting(key, row),
        input.value
      );
      if (!decision.ok) return decision;
      if (!decision.changed) return { ok: true, changed: false } as const;

      const stored = { value: decision.value, updatedByUserId, updatedAt: now };
      const written = row
        ? await tx
            .update(setting)
            .set(stored)
            .where(eq(setting.key, key))
            .returning({ key: setting.key })
        : await tx
            .insert(setting)
            .values({ key, ...stored })
            .onConflictDoNothing()
            .returning({ key: setting.key });
      if (written.length === 0) continue;

      await recordAudit(tx, ctx, {
        action: "setting.changed",
        entity: { type: "setting", id: key },
        before: decision.audit.before,
        after: decision.audit.after,
        actorRole,
      });
      return { ok: true, changed: true } as const;
    }
    throw new Error("Could not lock the setting's row");
  });
}
