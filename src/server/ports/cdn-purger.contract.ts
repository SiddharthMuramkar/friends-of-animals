import { describe, expect, it } from "vitest";
import type { CdnPurger } from "./cdn-purger";

export const CONTRACT_PATHS = ["/gallery", "/media/gallery/sample?size=thumb"];

export function cdnPurgerContract(
  name: string,
  setup: () => {
    purger: CdnPurger;
    purged(): readonly string[];
    failNext(): void;
  }
) {
  describe(`${name} (CdnPurger contract)`, () => {
    it("purges only the requested same-origin paths, including queries", async () => {
      const { purger, purged } = setup();
      await purger.purge(CONTRACT_PATHS);
      expect(purged()).toEqual(CONTRACT_PATHS);
    });
    it("refuses unsafe paths without partially purging", async () => {
      const { purger, purged } = setup();
      for (const unsafe of [
        "https://other.test/",
        "//other.test/",
        "/\\other.test/",
      ]) {
        await expect(purger.purge(["/gallery", unsafe])).rejects.toThrow();
        expect(purged()).toEqual([]);
      }
    });
    it("propagates an outage and can retry the same request", async () => {
      const { purger, purged, failNext } = setup();
      failNext();
      await expect(purger.purge(CONTRACT_PATHS)).rejects.toThrow();
      expect(purged()).toEqual([]);
      await purger.purge(CONTRACT_PATHS);
      expect(purged()).toEqual(CONTRACT_PATHS);
    });
  });
}
