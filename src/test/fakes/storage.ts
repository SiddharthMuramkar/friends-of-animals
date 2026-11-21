// In-memory ObjectStorage for Seam 1 tests (not built yet).

import type { Clock } from "@/server/ports/clock";
import type {
  ObjectRef,
  ObjectStorage,
  StoredObject,
} from "@/server/ports/storage";

export type FakeStorageRefusal =
  | "bad_signature"
  | "expired"
  | "wrong_method"
  | "header_mismatch"
  | "not_found";

export type FakePutResult = { ok: true } | { ok: false; error: FakeStorageRefusal };

export type FakeGetResult =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: string | null;
      contentDisposition: string | null;
    }
  | { ok: false; error: FakeStorageRefusal };

const notBuilt = () => Promise.reject(new Error("FakeStorage is not built yet"));

export class FakeStorage implements ObjectStorage {
  constructor(_clock: Clock) {}
  presignPut = notBuilt;
  presignGet = notBuilt;
  head = (_ref: ObjectRef): Promise<StoredObject | null> => notBuilt();
  read = notBuilt;
  move = notBuilt;
  delete = notBuilt;
  deletePrefix = notBuilt;
  put = (
    _url: string,
    _bytes: Uint8Array,
    _headers: Record<string, string>
  ): Promise<FakePutResult> => notBuilt();
  get = (_url: string): Promise<FakeGetResult> => notBuilt();
  plant(_ref: ObjectRef & { bytes: Uint8Array; contentType: string | null }) {
    throw new Error("FakeStorage is not built yet");
  }
  keys(_bucket: string): string[] {
    throw new Error("FakeStorage is not built yet");
  }
}
