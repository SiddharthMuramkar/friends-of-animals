import { connection, type NextRequest } from "next/server";

import { env } from "@/env";
import { localDiskStorageFor } from "@/server/deps";

import { downloadRequest, uploadRequest } from "../_lib/local-storage-request";

// A local run's object storage, where the browser PUTs uploads and fetches
// downloads through the disk store's signed URLs; a 404 on every
// deployment. Rules in ../_lib/local-storage-request.ts.

export async function PUT(request: NextRequest) {
  return uploadRequest(localDiskStorageFor(env()), request);
}

export async function GET(request: NextRequest) {
  // Wait for a real request, so `next build` never prerenders this.
  await connection();
  return downloadRequest(localDiskStorageFor(env()), request);
}
