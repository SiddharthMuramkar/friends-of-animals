import { connection, type NextRequest } from "next/server";

import { as, currentActor } from "@/server/app";

import { ledgerExportDownload } from "../_lib/export-download";

// The accountant's ledger export (#109). Rules in ../_lib/export-download.ts.

export async function GET(request: NextRequest) {
  // Wait for a real request, so `next build` never prerenders this.
  await connection();
  const actor = await currentActor();
  const { searchParams } = request.nextUrl;
  const download = await ledgerExportDownload(as(actor), {
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });
  if (download.status === 303) {
    return Response.redirect(new URL(download.location, request.url), 303);
  }
  return new Response(download.body, {
    status: download.status,
    headers: download.headers,
  });
}
