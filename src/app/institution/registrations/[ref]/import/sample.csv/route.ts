import { connection, type NextRequest } from "next/server";

import { isSampleContentEnabled } from "@/lib/site";
import { as, currentActor } from "@/server/app";

import { studentImportDownload, toResponse } from "../_lib/csv-downloads";

// The student import's sample file (#76), with good rows and one of each
// usual mistake, for trying the import on the preview: the 404 in
// production. Rules in ../_lib/csv-downloads.ts.

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/institution/registrations/[ref]/import/sample.csv">
) {
  // Wait for a real request, so `next build` never prerenders this.
  await connection();
  const { ref } = await ctx.params;
  const actor = await currentActor();
  return toResponse(
    await studentImportDownload(
      as(actor),
      {
        institutionId: request.nextUrl.searchParams.get("institution"),
        reference: ref,
        file: "sample.csv",
      },
      { samples: isSampleContentEnabled() }
    )
  );
}
