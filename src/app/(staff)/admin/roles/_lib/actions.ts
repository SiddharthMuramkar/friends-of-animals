"use server";

import { getTranslations } from "next-intl/server";
import { redirect, RedirectType } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { adminCall } from "../../_lib/boundary";
import {
  REFUSED,
  roleChangeOutcome,
  type RoleChangeOutcome,
  type RoleChangeResult,
} from "./action-result";
import type { RoleFormView } from "./form-view";
import { rolesHref } from "./href";
import { parseRoleForm } from "./role-form";
import type { SearchView } from "./search-view";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function refusedView(
  outcome: Extract<RoleChangeOutcome, { ok: false }>,
  values: RoleFormView["values"]
): Promise<RoleFormView> {
  const t = await getTranslations("adminRoles");
  const errors: RoleFormView["errors"] = {};
  for (const name of outcome.fields) {
    errors[name] =
      name === "scopeType" && outcome.alert === "scope_not_allowed"
        ? t("errors.scopeNotAllowed")
        : t(`errors.${name}`);
  }
  return { alert: t(`alerts.${outcome.alert}`), errors, values };
}

/**
 * Grants or revokes the role in the form. The use case checks who may;
 * a refusal comes back as a message for the form. A change that worked
 * goes back to the user's roles with `?done=…`, so the list is fresh and
 * the page says what happened.
 */
async function changeRole(
  change: "granted" | "revoked",
  formData: FormData
): Promise<RoleFormView> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);

  const values = {
    role: field(formData, "role"),
    scopeType: field(formData, "scopeType"),
    scopeId: field(formData, "scopeId"),
  };
  const parsed = parseRoleForm(formData);
  if (!parsed.ok) {
    return refusedView(
      { ok: false, alert: "invalid_input", fields: parsed.fields },
      values
    );
  }

  const app = as(actor);
  const called = await adminCall(
    () =>
      change === "granted"
        ? app.grantRole(parsed.input)
        : app.revokeRole(parsed.input),
    rolesHref({ user: parsed.input.userId })
  );
  const result: RoleChangeResult = called.ok ? called.value : REFUSED;

  const outcome = roleChangeOutcome(change, result);
  if (!outcome.ok) return refusedView(outcome, values);
  redirect(
    rolesHref({
      user: parsed.input.userId,
      done: outcome.done,
      at: Date.now().toString(36),
    }),
    RedirectType.replace
  );
}

export async function grantRoleAction(
  _previous: RoleFormView,
  formData: FormData
): Promise<RoleFormView> {
  return changeRole("granted", formData);
}

export async function revokeRoleAction(
  _previous: RoleFormView,
  formData: FormData
): Promise<RoleFormView> {
  return changeRole("revoked", formData);
}

/**
 * Finds people by name or email address for the roles page. The text comes
 * in a POST body and goes back in the form's state, never in a URL, which
 * browser history and request logs would keep.
 */
export async function searchUsersAction(
  _previous: SearchView,
  formData: FormData
): Promise<SearchView> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);

  const query = field(formData, "q");
  const [called, t] = await Promise.all([
    adminCall(() => as(actor).searchUsers({ query }), APP_ROUTES.adminRoles),
    getTranslations("adminRoles"),
  ]);
  if (!called.ok) return { query, error: t("search.forbidden") };
  const found = called.value;
  if (!found.ok) return { query, error: t("search.tooShort") };
  return {
    query,
    users: found.users,
    none:
      found.users.length === 0
        ? t("search.none", { query: query.trim() })
        : undefined,
  };
}
