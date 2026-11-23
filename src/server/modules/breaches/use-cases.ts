// The breach log's use cases, as `as(actor)` exposes them (#116).

import type { UseCaseContext } from "../../use-cases";
import { notifyAuthority } from "./authority";
import { notifyAffectedUsers } from "./notify";
import { getBreach, listBreaches } from "./read";
import {
  addBreachTimelineEvent,
  closeBreach,
  containBreach,
  recordBreach,
  updateBreach,
} from "./record";

export const breachesUseCases = (ctx: UseCaseContext) => ({
  recordBreach: (input: unknown) => recordBreach(ctx, input),
  updateBreach: (input: unknown) => updateBreach(ctx, input),
  addBreachTimelineEvent: (input: unknown) =>
    addBreachTimelineEvent(ctx, input),
  containBreach: (input: unknown) => containBreach(ctx, input),
  closeBreach: (input: unknown) => closeBreach(ctx, input),
  notifyAffectedUsers: (input: unknown) => notifyAffectedUsers(ctx, input),
  notifyAuthority: (input: unknown) => notifyAuthority(ctx, input),
  listBreaches: () => listBreaches(ctx),
  getBreach: (input: unknown) => getBreach(ctx, input),
});
