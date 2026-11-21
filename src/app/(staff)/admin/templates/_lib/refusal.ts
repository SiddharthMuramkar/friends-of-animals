import { DomainError } from "@/server/errors";

/** Runs `load`; a refused actor gets null instead of the error. */
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
