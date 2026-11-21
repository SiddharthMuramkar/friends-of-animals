// The access module (#59): scoped roles and the can() policy. Its use cases
// join `as(actor)` through `accessUseCases`.

import type { UseCaseContext } from "../use-cases";
import {
  grantRole,
  listUserRoles,
  revokeRole,
  type GrantChangeInput,
} from "./manage-roles";

export type {
  GrantChangeInput,
  GrantRoleResult,
  ListUserRolesResult,
  RevokeRoleResult,
  UserGrant,
} from "./manage-roles";
export { authorize, can } from "./can";

export const accessUseCases = (ctx: UseCaseContext) => ({
  grantRole: (input: GrantChangeInput) => grantRole(ctx, input),
  revokeRole: (input: GrantChangeInput) => revokeRole(ctx, input),
  listUserRoles: (input: { userId: string }) => listUserRoles(ctx, input),
});
