import { publicPurgePaths, type CdnPurger } from "@/server/ports/cdn-purger";
export class FakeCdnPurger implements CdnPurger {
  readonly purges: string[][] = [];
  private failures = 0;
  failNext(count = 1) {
    this.failures = count;
  }
  async purge(paths: readonly string[]) {
    const valid = publicPurgePaths(paths);
    if (this.failures > 0) {
      this.failures--;
      throw new Error("Fake CDN unavailable");
    }
    this.purges.push(valid);
  }
}
