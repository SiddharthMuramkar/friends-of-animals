import { connection, type NextRequest } from "next/server";

import { as, currentActor } from "@/server/app";

import { studentImportDownload, toResponse } from "../_lib/csv-downloads";

// The student import's blank template (#76), for whoever may import into
// the registration. Rules in ../_lib/csv-downloads.ts.

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/institution/registrations/[ref]/import/template.csv">
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
        file: "template.csv",
      },
      { samples: false }
    )
  );
}
