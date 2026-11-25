import type { BlindIndex } from "../../crypto/blind-index";
import { hashLinkToken } from "../../crypto/link-token";
export function surveyToken(blindIndex: BlindIndex, id: string) {
  const token = blindIndex.of("survey_invitation.answer_link", id);
  return { token, tokenHash: hashLinkToken(token) };
}
