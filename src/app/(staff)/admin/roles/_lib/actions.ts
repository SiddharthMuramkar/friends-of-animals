"use server";

import { getTranslations } from "next-intl/server";
import { redirect, RedirectType } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { isRefusal } from "../../_lib/refusal";
import {
  REFUSED,
  roleChangeOutcome,
  type RoleChangeOutcome,
  type RoleChangeResult,
} from "./action-result";
import type { RoleFormView } from "./form-view";
import { rolesHref } from "./href";
import { parseRoleForm } from "./role-form";

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

  let result: RoleChangeResult;
  try {
    const app = as(actor);
    result =
      change === "granted"
        ? await app.grantRole(parsed.input)
        : await app.revokeRole(parsed.input);
  } catch (error) {
    if (!isRefusal(error)) throw error;
    result = REFUSED;
  }

  const outcome = roleChangeOutcome(change, result);
  if (!outcome.ok) return refusedView(outcome, values);
  redirect(
    rolesHref({
      q: field(formData, "q"),
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
