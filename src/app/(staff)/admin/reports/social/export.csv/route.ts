import { connection } from "next/server";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";

export async function GET(request: Request) {
  await connection();
  const actor = await currentActor();
  const query = new URL(request.url).searchParams;
  const one = (key: string) =>
    query.getAll(key).length === 1 ? query.get(key)! : "";
  const headers = { "Cache-Control": "no-store" };
  try {
    const result = await as(actor).exportSocialReportCsv({
      from: one("from"),
      to: one("to"),
    });
    if (!result.ok) return new Response(null, { status: 400, headers });
    return new Response(result.csv, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof DomainError)
      return new Response(null, { status: 403, headers });
    throw new Error(`Report export failed: ${errorSummaryForLogs(error)}`);
  }
}
