// The R2 adapter (not built yet).

import type { S3ClientConfig } from "@aws-sdk/client-s3";

import type { Clock } from "./clock";
import type { ObjectStorage } from "./storage";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function r2Storage(
  _config: R2Config,
  _clock: Clock,
  _requestHandler?: S3ClientConfig["requestHandler"]
): ObjectStorage {
  const notBuilt = () =>
    Promise.reject(new Error("r2Storage is not built yet"));
  return {
    presignPut: notBuilt,
    presignGet: notBuilt,
    head: notBuilt,
    read: notBuilt,
    move: notBuilt,
    delete: notBuilt,
    deletePrefix: notBuilt,
  };
}
