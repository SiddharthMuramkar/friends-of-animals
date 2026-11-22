import { DomainError } from "@/server/errors";

/** Whether a use case threw because the policy refused the actor. */
export function isRefusal(error: unknown): boolean {
  return error instanceof DomainError && error.code === "forbidden";
}
