import type { competitionInvitation } from "../../db/schema";
import { invitationAudience, type AudienceDeps } from "./audience";
import { publishedRelease } from "../results/read-published";
import { readSetting } from "../settings/read";

type Invitation = typeof competitionInvitation.$inferSelect;

export async function currentRecipient(deps: AudienceDeps, invite: Invitation) {
  if (
    invite.status === "skipped" ||
    !invite.recipientUserId ||
    !(await readSetting(deps.db, "invitations.enabled"))
  )
    return null;
  const release = await publishedRelease(deps.db, invite.competitionId);
  if (
    !release ||
    release.releaseId !== invite.releaseId ||
    release.publishedAt > deps.clock.now()
  )
    return null;
  const recipient = (
    await invitationAudience(deps, invite.competitionId, [
      invite.participantProfileId,
    ])
  ).get(invite.participantProfileId);
  return recipient?.userId === invite.recipientUserId ? recipient : null;
}
