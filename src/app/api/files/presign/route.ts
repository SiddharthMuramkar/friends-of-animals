import type { NextRequest } from "next/server";

import { as, currentActor } from "@/server/app";

import { presignRequest, readJson, toResponse } from "../_lib/file-requests";

// Presigns an upload: POST { purpose, contentType, sizeBytes } as JSON.
// Rules in ../_lib/file-requests.ts. A POST handler is never prerendered.

export async function POST(request: NextRequest) {
  const actor = await currentActor();
  return toResponse(await presignRequest(as(actor), await readJson(request)));
}
