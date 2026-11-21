// In-memory CopyBucket for Seam 1 tests of the off-site copy (#68): one
// instance stands for R2's production buckets, another for the B2 bucket.
// Passes src/server/ports/copy-bucket.contract.ts.

import type {
  CopyBucket,
  ListedObject,
  ReadObject,
  WriteObject,
} from "@/server/ports/copy-bucket";

export class FakeCopyBucket implements CopyBucket {
  list(_input: {
    bucket: string;
    prefix?: string;
  }): AsyncIterable<ListedObject> {
    return {
      [Symbol.asyncIterator]() {
        throw new Error("not implemented");
      },
    };
  }

  async read(_input: {
    bucket: string;
    key: string;
  }): Promise<ReadObject | null> {
    throw new Error("not implemented");
  }

  async write(_input: WriteObject): Promise<void> {
    throw new Error("not implemented");
  }

  async delete(_input: { bucket: string; key: string }): Promise<void> {
    throw new Error("not implemented");
  }

  async exists(_input: { bucket: string; key: string }): Promise<boolean> {
    throw new Error("not implemented");
  }
}
