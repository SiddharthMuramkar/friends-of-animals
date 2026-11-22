import { DomainError } from "@/server/errors";

/** Whether a use case refused the actor (they lack the role). */
export function isForbidden(error: unknown): boolean {
  return error instanceof DomainError && error.code === "forbidden";
}
