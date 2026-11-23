"use server";

import { refresh } from "next/cache";

import { as, currentActor, type UseCases } from "@/server/app";
import { DomainError } from "@/server/errors";
import { StorageNotConfiguredError } from "@/server/ports/storage";

async function coordinatorAction<T>(run: (useCases: UseCases) => Promise<T>) {
  const actor = await currentActor();
  if (actor.kind !== "user") return { ok: false, error: "forbidden" } as const;
  try {
    return await run(as(actor));
  } catch (error) {
    if (error instanceof DomainError)
      return { ok: false, error: "forbidden" } as const;
    if (error instanceof StorageNotConfiguredError)
      return { ok: false, error: "storage_unavailable" } as const;
    throw error;
  }
}

export async function requestSignedFormUploadAction(
  input: Parameters<UseCases["requestConsentFormUpload"]>[0]
) {
  return coordinatorAction((useCases) =>
    useCases.requestConsentFormUpload(input)
  );
}

type SubmitInput = Parameters<UseCases["submitConsentForm"]>[0];

export async function submitSignedFormAction(
  input: SubmitInput & { documentIds: NonNullable<SubmitInput["documentIds"]> }
) {
  if (!input?.documentIds)
    return { ok: false, error: "invalid_input" } as const;
  const result = await coordinatorAction((useCases) =>
    useCases.submitConsentForm(input)
  );
  if (result.ok) refresh();
  return result;
}

type Command =
  | { kind: "declare"; registrationId: string }
  | { kind: "withdraw"; formId: string };
type CommandState = {
  error?:
    | "forbidden"
    | "storage_unavailable"
    | "invalid_input"
    | "unavailable"
    | "not_found"
    | "not_pending";
};

export async function signedFormCommandAction(
  command: Command,
  _state: CommandState
): Promise<CommandState> {
  const result = await coordinatorAction(async (useCases) => {
    return command.kind === "declare"
      ? useCases.declareParticipation({
          registrationId: command.registrationId,
        })
      : useCases.withdrawConsentForm({ formId: command.formId });
  });
  if (!result.ok) return { error: result.error };
  refresh();
  return {};
}
