import {
  CSP_REPORT_MAX_BYTES,
  createReportBudget,
  parseCspReport,
} from "@/lib/csp-report";

// Browsers post CSP violation reports here (report-uri and report-to in
// src/lib/csp.ts). Each violation becomes one scrubbed JSON log line;
// nothing is stored and no IP is kept. Edge plumbing with no actor and no
// domain state, so it skips as(actor) and can().

const headers = { "Cache-Control": "no-store" };

/** Violations logged per minute by this instance, across every sender. */
const budget = createReportBudget({
  limit: 100,
  windowMs: 60_000,
  now: () => Date.now(),
});

/**
 * The body as text, reading at most `limit` bytes so an endless stream
 * can't fill memory. A longer body comes back cut at `limit` bytes.
 */
async function readUpTo(request: Request, limit: number): Promise<string> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes.subarray(0, limit));
}

export async function POST(request: Request): Promise<Response> {
  // One byte over the cap is enough for parseCspReport to answer 413.
  const body = await readUpTo(request, CSP_REPORT_MAX_BYTES + 1);
  const result = parseCspReport(request.headers.get("content-type"), body);
  if (!result.ok) {
    return new Response(null, { status: result.status, headers });
  }
  const logged = result.violations.slice(
    0,
    budget.take(result.violations.length)
  );
  for (const violation of logged) {
    console.warn(JSON.stringify({ event: "csp.violation", ...violation }));
  }
  return new Response(null, { status: 204, headers });
}
