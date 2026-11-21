// The grant and revoke forms' fields, read into the use cases' input. Only
// the shape is checked here; the use case checks ids and which scopes a
// role may have.

import type { GrantChangeInput } from "@/server/access";

import type { RoleField } from "./action-result";

export type ParsedRoleForm =
  | { ok: true; input: GrantChangeInput }
  | { ok: false; fields: RoleField[] };

export function parseRoleForm(_form: FormData): ParsedRoleForm {
  throw new Error("Not implemented");
}
