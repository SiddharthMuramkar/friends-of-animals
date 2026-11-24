import type { z } from "zod";

import type { Actor } from "@/server/actor";
import type { UseCases } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { invalidInput, type InvalidInput } from "@/server/input";
import { StorageNotConfiguredError } from "@/server/ports/storage";

/** What an entry form action answers: the use case's result, or why it never ran. */
export type ParticipantActionResult<Result> =
  | Result
  | InvalidInput
  | {
      ok: false;
      error: "signed_out" | "forbidden" | "storage_unavailable" | "unknown";
    };

/** Maps the use-case response to what the entry form can show. */
export async function forParticipant<Input, Result>(
  currentActor: () => Promise<Actor>,
  as: (actor: Actor) => UseCases,
  schema: z.ZodType<Input>,
  input: unknown,
  run: (app: UseCases, data: Input) => Promise<Result>
): Promise<ParticipantActionResult<Result>> {
  try {
    const actor = await currentActor();
    if (actor.kind !== "user")
      return { ok: false, error: "signed_out" } as const;
    const parsed = schema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    return await run(as(actor), parsed.data);
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return { ok: false, error: "forbidden" } as const;
    }
    if (error instanceof StorageNotConfiguredError) {
      return { ok: false, error: "storage_unavailable" } as const;
    }
    console.error(`Entry upload failed: ${errorSummaryForLogs(error)}`);
    return { ok: false, error: "unknown" } as const;
  }
}
