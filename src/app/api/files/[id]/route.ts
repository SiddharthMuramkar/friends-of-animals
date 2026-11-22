import { connection, type NextRequest } from "next/server";

import { as, currentActor } from "@/server/app";

import { downloadRequest, toResponse } from "../_lib/file-requests";

// Opens a file: a 302 to a 5-minute signed URL, for whoever can() and the
// file's status allow. Rules in ../_lib/file-requests.ts.

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/files/[id]">
) {
  // Wait for a real request, so `next build` never prerenders this.
  await connection();
  const { id } = await ctx.params;
  const actor = await currentActor();
  return toResponse(await downloadRequest(as(actor), id));
}
