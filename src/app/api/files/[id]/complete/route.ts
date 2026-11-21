import type { NextRequest } from "next/server";

import { as, currentActor } from "@/server/app";

import { completeRequest, toResponse } from "../../_lib/file-requests";

// Confirms an upload once the browser's PUT has finished. Rules in
// ../../_lib/file-requests.ts. A POST handler is never prerendered.

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/files/[id]/complete">
) {
  const { id } = await ctx.params;
  const actor = await currentActor();
  return toResponse(await completeRequest(as(actor), id));
}
