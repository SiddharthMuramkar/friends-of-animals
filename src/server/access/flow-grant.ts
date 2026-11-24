// A global role that a flow grants by itself, not a staff member (#81):
// verifying as a guardian gives `guardian`, and accepting a teen login gives
// `participant`. No user grants it, so the grant and its audit entry name no
// granting user or role. Approving a volunteer application (#123) gives
// `volunteer`: the community manager who approved is named as the granting
// user, with the role that allowed it. Staff roles never come this way,
// because granting one also caps the grantee's sessions (./manage-roles.ts).

import { recordAudit } from "../audit/record";
import type { AppDb } from "../db/app-db";
import { userRole } from "../db/schema";
import { uuidv7 } from "../ids";
import type { UseCaseContext } from "../use-cases";
import { sortGrants, type Grant, type Role } from "./domain/roles";
import { grantsOf } from "./grants";

/** The roles a flow may grant by itself. */
export type FlowGrantedRole = "guardian" | "participant" | "volunteer";

/**
 * Grants `role` everywhere to `userId`, with its audit entry; holding it
 * already changes nothing. Call it inside the flow's transaction, holding
 * the user's row lock as other role changes do. `decidedBy` names the
 * role of the acting user whose decision grants it (a community manager
 * approving a volunteer); without it no granting user is named.
 */
export async function grantGlobalRole(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  userId: string,
  role: FlowGrantedRole,
  decidedBy?: { actorRole: Role | null }
): Promise<void> {
  const now = ctx.clock.now();
  const grant: Grant = { role, scope: { type: "global" } };
  const before = await grantsOf(tx, userId);
  const [inserted] = await tx
    .insert(userRole)
    .values({
      id: uuidv7(now),
      userId,
      role,
      scopeType: "global",
      scopeId: null,
      grantedByUserId:
        decidedBy && ctx.actor.kind === "user" ? ctx.actor.userId : null,
      grantedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: userRole.id });
  if (!inserted) return;
  await recordAudit(tx, ctx, {
    action: "role.granted",
    entity: { type: "user", id: userId },
    before,
    after: sortGrants([...before, grant]),
    actorRole: decidedBy?.actorRole ?? null,
  });
}
