import type { Animal } from "~/db/schema";
import { getStorage } from "~/lib/storage/index.server";

/** Adds a browser-usable `photoUrl` (or null) derived from `photoKey`. */
export function withPhotoUrl<T extends Pick<Animal, "photoKey">>(animal: T) {
  return {
    ...animal,
    photoUrl: animal.photoKey ? getStorage().url(animal.photoKey) : null,
  };
}
