// The volunteers module (#123): applying to volunteer, the guardian's
// approval for 14- to 17-year-olds and the community manager's vetting.
// Its use cases join `as(actor)` through `volunteersUseCases`.

import type { UseCaseContext } from "../../use-cases";
import { myVolunteerApplication } from "./queries";

export type { MyVolunteerApplication } from "./queries";

export const volunteersUseCases = (ctx: UseCaseContext) => ({
  myVolunteerApplication: () => myVolunteerApplication(ctx),
});
