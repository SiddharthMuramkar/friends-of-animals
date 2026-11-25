import { eq } from "drizzle-orm";
import { club, institution } from "../../db/schema";
import { DomainError } from "../../errors";
import type { AppDb } from "../../db/app-db";
import type { UseCaseContext } from "../../use-cases";

export function userId(ctx: UseCaseContext) {
  if (ctx.actor.kind !== "user")
    throw new DomainError("forbidden", "A signed-in person is required");
  return ctx.actor.userId;
}
export const refused = <T extends string>(error: T) => ({
  ok: false as const,
  error,
});
export async function lockInstitution(tx: AppDb, id: string) {
  const [row] = await tx
    .select()
    .from(institution)
    .where(eq(institution.id, id))
    .for("update");
  return row;
}
/** All place and membership writes follow school then club lock order. */
export async function lockedClub(tx: AppDb, id: string) {
  const [identity] = await tx
    .select({ institutionId: club.institutionId })
    .from(club)
    .where(eq(club.id, id));
  if (!identity) return null;
  const school = await lockInstitution(tx, identity.institutionId);
  const [row] = await tx
    .select()
    .from(club)
    .where(eq(club.id, id))
    .for("update");
  return row && school ? { row, school } : null;
}
