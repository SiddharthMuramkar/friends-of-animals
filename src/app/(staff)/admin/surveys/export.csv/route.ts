import { connection, type NextRequest } from "next/server";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
export async function GET(request: NextRequest) {
  await connection();
  try {
    const result = await as(await currentActor()).exportSurvey({
      competitionId: request.nextUrl.searchParams.get("competitionId") ?? "",
    });
    if (!result.ok) return new Response(null, { status: 404 });
    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    return new Response(null, { status: 403 });
  }
}
