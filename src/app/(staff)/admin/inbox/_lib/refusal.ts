import { DomainError, type DomainErrorCode } from "@/server/errors";

export type Loaded<T> =
  | { ok: true; value: T }
  | { ok: false; refusal: DomainErrorCode };

/**
 * Runs `load`. An actor the use case refuses gets why instead of the
 * error: not on a team that handles contact messages (`forbidden`), or a
 * member of staff who hasn't passed this session's second step (#60). Any
 * other error goes on.
 */
export async function unlessRefused<T>(
  load: () => Promise<T>
): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, refusal: error.code };
    }
    throw error;
  }
}
