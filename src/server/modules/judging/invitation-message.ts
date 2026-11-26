// Resolve secrets only at delivery time, as for institution invitations.
import { judgeInvitationPath } from "../../../lib/app-routes";
import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import messages from "../../../../messages/en-IN/judging.json";
import { judgeInvitation, judgingRound } from "../../db/schema";
import type { OutboxDeps } from "../../outbox/handlers";
import { JUDGE_EMAIL, JUDGE_TOKEN } from "./judges";
import { acceptsJudges } from "./domain/round-status";
const t = createTranslator({
  locale: "en-IN",
  messages,
  namespace: "judging.invitationMessage",
});
export async function sendJudgeInvitation(
  deps: OutboxDeps,
  { invitationId }: { invitationId: string }
) {
  const [row] = await deps.db
    .select({
      invitation: judgeInvitation,
      round: judgingRound.name,
      roundStatus: judgingRound.status,
    })
    .from(judgeInvitation)
    .innerJoin(judgingRound, eq(judgingRound.id, judgeInvitation.roundId))
    .where(eq(judgeInvitation.id, invitationId));
  if (
    !row ||
    !row.invitation.tokenCiphertext ||
    row.invitation.status !== "pending" ||
    row.invitation.expiresAt <= deps.clock.now() ||
    !acceptsJudges(row.roundStatus)
  )
    return;
  if (!deps.auth.baseUrl)
    throw new Error(`Judge invitation ${invitationId} needs APP_URL`);
  const token = deps.cipher.decrypt(
    JUDGE_TOKEN,
    row.invitation.tokenCiphertext
  );
  const link = new URL(
    judgeInvitationPath(token),
    deps.auth.baseUrl
  ).toString();
  await deps.email.send({
    to: deps.cipher.decrypt(JUDGE_EMAIL, row.invitation.emailCiphertext),
    subject: t("subject", { round: row.round }),
    text: t("text", { round: row.round, link }),
  });
}
