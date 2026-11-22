// The access module (#59): scoped roles and the can() policy. Its use cases
// join `as(actor)` through `accessUseCases`.

import type { UseCaseContext } from "../use-cases";
import {
  grantRole,
  listUserRoles,
  revokeRole,
  type GrantChangeInput,
} from "./manage-roles";
import { myAccess } from "./my-access";
import { searchUsers } from "./search-users";

export type {
  GrantChangeInput,
  GrantRoleResult,
  ListUserRolesResult,
  RevokeRoleResult,
  UserGrant,
} from "./manage-roles";
export type { MyAccess } from "./my-access";
export type { FoundUser, SearchUsersResult } from "./search-users";
export type { Dashboard } from "./domain/dashboards";
export type { Grant, Role, Scope, ScopeType } from "./domain/roles";
export { authorize, can } from "./can";

export const accessUseCases = (ctx: UseCaseContext) => ({
  grantRole: (input: GrantChangeInput) => grantRole(ctx, input),
  revokeRole: (input: GrantChangeInput) => revokeRole(ctx, input),
  listUserRoles: (input: { userId: string }) => listUserRoles(ctx, input),
  searchUsers: (input: { query: string }) => searchUsers(ctx, input),
  myAccess: () => myAccess(ctx),
});
