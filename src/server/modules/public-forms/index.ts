// Shared guards for public forms (#113, H42): the human check and per-sender
// rate limits. The contact form uses them first; #116's concern reports and
// later public forms reuse them.

import type { HumanCheckChallenge } from "../../ports/human-check";
import type { UseCaseContext } from "../../use-cases";

export const publicFormUseCases = (ctx: UseCaseContext) => ({
  issueHumanCheckChallenge: async (): Promise<HumanCheckChallenge> => {
    void ctx;
    throw new Error("not built yet");
  },
});
