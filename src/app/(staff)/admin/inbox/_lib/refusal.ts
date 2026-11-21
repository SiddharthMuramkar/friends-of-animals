import { DomainError } from "@/server/errors";

/** Runs `load`; an actor who may not open the inbox gets null instead. */
export async function unlessForbidden<T>(load: () => Promise<T>) {
  try {
    return await load();
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return null;
    }
    throw error;
  }
}
