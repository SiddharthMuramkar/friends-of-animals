"use server";

import { refresh } from "next/cache";
import { redirect, RedirectType, unstable_rethrow } from "next/navigation";

import { APP_ROUTES, guardianChildPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import type { WithdrawTeenInvitationResult } from "@/server/modules/guardians";

import {
  afterAddChild,
  afterDeclare,
  afterInvite,
  type AddChildState,
  type AddChildValues,
  isCodeError,
  type CodeError,
  type ChildOutcome,
  type DeclareState,
  type InviteState,
} from "./form-state";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedInActor() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** A query that is new each time, so a repeated outcome is announced too. */
function fresh(params: Record<string, string>): string {
  return new URLSearchParams({
    ...params,
    n: Date.now().toString(36),
  }).toString();
}

function codeStep(params: Record<string, string> = {}): never {
  redirect(
    `${APP_ROUTES.guardianRegister}?${fresh({ step: "code", ...params })}`,
    RedirectType.replace
  );
}

/**
 * Records the declaration, then emails the code and goes on to the code
 * step. A refusal comes back to the form with what was typed.
 */
export async function declareGuardianAction(
  previous: DeclareState,
  formData: FormData
): Promise<DeclareState> {
  const actor = await signedInActor();
  const values = {
    fullName: field(formData, "fullName"),
    phone: field(formData, "phone"),
    adultDeclared: formData.get("adultDeclared") === "on",
  };
  try {
    const declared = await as(actor).registerAsGuardian(values);
    if (!declared.ok) {
      if (declared.error === "already_verified") redirect(APP_ROUTES.guardian);
      return afterDeclare(previous, values, declared);
    }
    const sent = await as(actor).startGuardianVerification();
    if (!sent.ok) {
      if (sent.error === "already_verified") redirect(APP_ROUTES.guardian);
      if (sent.error === "not_registered") {
        throw new Error("A guardian just declared isn't registered");
      }
      return afterDeclare(previous, values, sent);
    }
  } catch (error) {
    // redirect() throws too; let it through.
    unstable_rethrow(error);
    console.error(`declareGuardian failed: ${errorSummaryForLogs(error)}`);
    return afterDeclare(previous, values, "unexpected");
  }
  codeStep();
}

/** Checks the code; on success the guardian lands on their children. */
export async function confirmGuardianCodeAction(
  formData: FormData
): Promise<void> {
  const actor = await signedInActor();
  let error: CodeError | undefined;
  try {
    const result = await as(actor).confirmGuardianVerification({
      code: field(formData, "code"),
    });
    if (result.ok || result.error === "already_verified") {
      // Re-renders the header too, which now leads to "My children".
      refresh();
      redirect(APP_ROUTES.guardian, RedirectType.replace);
    }
    error = isCodeError(result.error) ? result.error : "unexpected";
  } catch (thrown) {
    unstable_rethrow(thrown);
    console.error(
      `confirmGuardianVerification failed: ${errorSummaryForLogs(thrown)}`
    );
    error = "unexpected";
  }
  codeStep({ error });
}

/** Emails a fresh code and comes back to the code step. */
export async function resendGuardianCodeAction(): Promise<void> {
  const actor = await signedInActor();
  let error: CodeError | undefined;
  try {
    const sent = await as(actor).startGuardianVerification();
    if (!sent.ok && sent.error === "already_verified") {
      redirect(APP_ROUTES.guardian, RedirectType.replace);
    }
    if (!sent.ok) error = isCodeError(sent.error) ? sent.error : "unexpected";
  } catch (thrown) {
    unstable_rethrow(thrown);
    console.error(
      `startGuardianVerification failed: ${errorSummaryForLogs(thrown)}`
    );
    error = "unexpected";
  }
  codeStep(error ? { error } : { resent: "1" });
}

/** Adds the child and opens their page; a refusal keeps what was typed. */
export async function addChildAction(
  previous: AddChildState,
  formData: FormData
): Promise<AddChildState> {
  const actor = await signedInActor();
  const values: AddChildValues = {
    fullName: field(formData, "fullName"),
    dateOfBirth: field(formData, "dateOfBirth"),
    relationship: field(formData, "relationship"),
  };
  let childId: string;
  try {
    const result = await as(actor).addChild(values);
    if (!result.ok) {
      if (result.error === "guardian_not_verified") {
        redirect(APP_ROUTES.guardianRegister);
      }
      return afterAddChild(previous, values, result);
    }
    childId = result.childId;
  } catch (error) {
    unstable_rethrow(error);
    console.error(`addChild failed: ${errorSummaryForLogs(error)}`);
    return afterAddChild(previous, values, "unexpected");
  }
  backToChild(childId, "added");
}

function backToChild(childId: string, done: ChildOutcome): never {
  redirect(
    `${guardianChildPath(childId)}?${fresh({ done })}`,
    RedirectType.replace
  );
}

/** Invites the teen; a refusal comes back with the address typed. */
export async function inviteTeenAction(
  childId: string,
  _previous: InviteState,
  formData: FormData
): Promise<InviteState> {
  const actor = await signedInActor();
  const email = field(formData, "email");
  try {
    const result = await as(actor).inviteTeenLogin({ childId, email });
    if (!result.ok) return afterInvite(email, result);
  } catch (error) {
    console.error(`inviteTeenLogin failed: ${errorSummaryForLogs(error)}`);
    return afterInvite(email, "unexpected");
  }
  backToChild(childId, "invited");
}

/**
 * Withdraws the waiting invitation and comes back to the child's page. A
 * child this guardian may no longer manage leads back to their children.
 */
export async function withdrawTeenInvitationAction(
  childId: string
): Promise<void> {
  const actor = await signedInActor();
  let result: WithdrawTeenInvitationResult;
  try {
    result = await as(actor).withdrawTeenInvitation({ childId });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    redirect(APP_ROUTES.guardian, RedirectType.replace);
  }
  backToChild(childId, result.ok ? "withdrawn" : result.error);
}
