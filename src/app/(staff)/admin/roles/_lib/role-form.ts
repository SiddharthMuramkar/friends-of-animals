// The grant and revoke forms' fields, read into the use cases' input. Only
// the shape is checked here; the use case checks ids and which scopes a
// role may have.

import { z } from "zod";

import type { GrantChangeInput } from "@/server/access";
import { ROLES, SCOPE_TYPES } from "@/server/access/domain/roles";

import type { RoleField } from "./action-result";

export type ParsedRoleForm =
  | { ok: true; input: GrantChangeInput }
  | { ok: false; fields: RoleField[] };

const roleForm = z.object({
  userId: z.string().trim(),
  role: z.enum(ROLES),
  scopeType: z.enum(SCOPE_TYPES),
  scopeId: z.string().trim(),
});

/** A form field's value, or "" when it is missing or a file. */
function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function parseRoleForm(form: FormData): ParsedRoleForm {
  const parsed = roleForm.safeParse({
    userId: text(form, "userId"),
    role: text(form, "role"),
    scopeType: text(form, "scopeType"),
    scopeId: text(form, "scopeId"),
  });
  if (!parsed.success) {
    const fields = new Set(
      parsed.error.issues.map((issue) => String(issue.path[0]) as RoleField)
    );
    return { ok: false, fields: [...fields] };
  }
  const { userId, role, scopeType, scopeId } = parsed.data;
  // A global role has no id, so one typed by mistake is left out.
  if (scopeType === "global") {
    return { ok: true, input: { userId, role, scope: { type: "global" } } };
  }
  if (scopeId === "") return { ok: false, fields: ["scopeId"] };
  return {
    ok: true,
    input: { userId, role, scope: { type: scopeType, id: scopeId } },
  };
}
