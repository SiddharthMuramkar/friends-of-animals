// The guardians module (#81): a signed-in User declares they are a child's
// parent or lawful guardian and verifies by a one-time code; a verified
// Guardian adds children (under 13: a profile they manage, with no login;
// 13 to 17: invited to an own login, linked to them).
//
// Its use cases join `as(actor)` in src/server/app.ts once the units named
// in ./ports.ts land; until then they take those ports as an argument.

import type { UseCaseContext } from "../../use-cases";
import type { GuardianPorts, GuardiansContext } from "./ports";

export type { GuardianPorts } from "./ports";

export const guardiansUseCases =
  (ports: GuardianPorts) => (ctx: UseCaseContext) => {
    const g: GuardiansContext = { ...ctx, ...ports };
    void g;
    return {};
  };

export type GuardiansUseCases = ReturnType<
  ReturnType<typeof guardiansUseCases>
>;
