// Reading volunteer applications: an applicant's own.

import type { UseCaseContext } from "../../use-cases";
import { authorize } from "./policy";

/** What an applicant sees of their application. */
export type MyVolunteerApplication = never;

/** The signed-in user's latest application, or null if they never applied. */
export async function myVolunteerApplication(
  ctx: UseCaseContext
): Promise<MyVolunteerApplication | null> {
  authorize(ctx.actor, "volunteer.view-own");
  return null;
}
