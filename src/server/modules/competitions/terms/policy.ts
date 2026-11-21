// Who may change a competition's terms (#72): a competition manager, held
// globally or for that competition. Fees are money, so changing them is
// to need a fresh second factor too (#55 story 20: step-up for money
// operations); awards and documents don't. The step-up rule arrives with
// #60, which this branch doesn't stack on yet.
//
// Loads under plain Node: relative imports only.

import {
  role,
  type Policy,
  type Resource,
  type Rule,
} from "../../../access/domain/policy";

/** Allows everyone: published document versions are public text. */
const anyone: Rule = () => ({ allowed: true, role: null });

export const COMPETITION_TERMS_POLICY = {
  "competition.view_terms": role("competition_manager"),
  "competition.set_fees": role("competition_manager"),
  "competition.set_awards": role("competition_manager"),
  "competition.attach_document": role("competition_manager"),
  "competition.read_document": anyone,
} satisfies Policy<string>;

export type CompetitionTermsAction = keyof typeof COMPETITION_TERMS_POLICY;

/** The competition as a policy resource: grants scoped to it cover it. */
export function competitionResource(competitionId: string): Resource {
  return { scopes: [{ type: "competition", id: competitionId }] };
}
