// The accountant's ledger export as a download (#109), as a plain function
// over the use cases so it is tested at Seam 1; the route handler only
// resolves the actor and passes the query in.
//
//   GET /admin/ledger/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Finance gets the CSV as an attachment that is never cached. A refusal
// the user can lift (a second factor that isn't fresh) sends them to lift
// it and back to the export page; a bad range goes back to the page with
// the reason; anyone else gets no file.

import { ADMIN_LEDGER_EXPORT } from "@/lib/app-routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import type { UseCases } from "@/server/app";
import { DomainError } from "@/server/errors";

export type ExportDownload =
  | {
      status: 200;
      body: string;
      headers: Record<string, string>;
    }
  | { status: 303; location: string }
  | { status: 403; body: null; headers: Record<string, string> };

function exportPage(query: Record<string, string>) {
  const search = new URLSearchParams(query).toString();
  return search ? `${ADMIN_LEDGER_EXPORT}?${search}` : ADMIN_LEDGER_EXPORT;
}

export async function ledgerExportDownload(
  app: Pick<UseCases, "exportLedger">,
  query: { from: string | null; to: string | null }
): Promise<ExportDownload> {
  const from = query.from ?? "";
  const to = query.to ?? "";
  let result: Awaited<ReturnType<UseCases["exportLedger"]>>;
  try {
    result = await app.exportLedger({ from, to });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const lift = secondFactorPath(error.code, exportPage({ from, to }));
    if (lift) return { status: 303, location: lift };
    return {
      status: 403,
      body: null,
      headers: { "Cache-Control": "no-store" },
    };
  }
  if (!result.ok) {
    return {
      status: 303,
      location: exportPage({ from, to, error: result.error }),
    };
  }
  return {
    status: 200,
    body: result.csv,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  };
}
