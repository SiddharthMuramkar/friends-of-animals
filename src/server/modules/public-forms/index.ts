// Shared guards for public forms (#113, H42): the human check and
// per-sender rate limits. The contact form uses them first; #116's concern
// reports and later public forms reuse them.
//
//   issueHumanCheckChallenge() → a challenge for the form island to solve

import type { HumanCheckChallenge } from "../../ports/human-check";
import type { UseCaseContext } from "../../use-cases";
import { publicSender } from "./policy";

export type {
  HumanCheckChallenge,
  HumanCheckProof,
} from "../../ports/human-check";
export { formKeyedHash, type KeyedHash } from "./keyed-hash";
export { publicSender } from "./policy";
export {
  takeFormAllowance,
  type FormAllowance,
  type FormRateRule,
} from "./rate-limit";

/** A challenge for the form island. Stores nothing (it travels signed). */
async function issueHumanCheckChallenge(
  ctx: UseCaseContext
): Promise<HumanCheckChallenge> {
  await publicSender(ctx, "human-check.issue");
  return ctx.humanCheck.challenge(ctx.clock.now());
}

export const publicFormUseCases = (ctx: UseCaseContext) => ({
  issueHumanCheckChallenge: () => issueHumanCheckChallenge(ctx),
});
