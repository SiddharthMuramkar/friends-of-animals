/**
 * Reads the CSP violation reports browsers send to /api/csp-report and keeps
 * only what finding a broken policy needs: the page, the directive, what was
 * blocked and where. URLs lose their query and fragment (they can carry an
 * email or a token), script samples and referrers are dropped, and nothing
 * here sees the IP or the user agent.
 *
 * Two formats arrive: the legacy `application/csp-report` body sent for
 * `report-uri`, and the Reporting API's `application/reports+json` batch
 * sent for `report-to`.
 */

import { z } from "zod";

/** One violation, safe to log. */
export type CspViolation = {
  /** The page's origin and path. */
  documentUrl: string;
  directive: string;
  /** "inline", "eval", an origin and path, or a bare scheme like "data:". */
  blocked: string;
  sourceFile?: string;
  line?: number;
  column?: number;
  disposition?: "enforce" | "report";
};

export type CspReportResult =
  | { ok: true; violations: CspViolation[] }
  | { ok: false; status: 400 | 413 | 415 };

/** Keywords browsers put in place of a URL; kept as they are. */
const BLOCKED_KEYWORDS = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "trusted-types-policy",
  "trusted-types-sink",
]);

const MAX_TEXT = 300;

/** Bodies over this many bytes are refused with 413. */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;

/** At most this many violations are kept from one Reporting API batch. */
export const CSP_REPORT_MAX_VIOLATIONS = 20;

/** An http(s) URL as origin and path; any other URL as its scheme only. */
function scrubUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol === "https:" || url.protocol === "http:") {
    return `${url.origin}${url.pathname}`.slice(0, MAX_TEXT);
  }
  return url.protocol;
}

function scrubBlocked(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "other";
  if (BLOCKED_KEYWORDS.has(raw)) return raw;
  return scrubUrl(raw) ?? "other";
}

/** "script-src-elem", or the first word of an older "script-src 'self'". */
function directiveName(raw: string | undefined): string {
  const name = raw?.trim().split(/\s+/)[0] ?? "";
  return /^[a-z-]{1,40}$/.test(name) ? name : "unknown";
}

const position = z.number().int().nonnegative().optional().catch(undefined);
const text = z.string().optional().catch(undefined);

const legacyBody = z.object({
  "csp-report": z.object({
    "document-uri": text,
    "violated-directive": text,
    "effective-directive": text,
    "blocked-uri": text,
    "source-file": text,
    "line-number": position,
    "column-number": position,
    disposition: text,
  }),
});

const reportingBatch = z.array(
  z.object({
    type: z.string(),
    body: z
      .object({
        documentURL: text,
        effectiveDirective: text,
        blockedURL: text,
        sourceFile: text,
        lineNumber: position,
        columnNumber: position,
        disposition: text,
      })
      .optional()
      .catch(undefined),
  })
);

type Fields = {
  documentUrl: string | undefined;
  directive: string | undefined;
  blocked: string | undefined;
  sourceFile: string | undefined;
  line: number | undefined;
  column: number | undefined;
  disposition: string | undefined;
};

function violation(fields: Fields): CspViolation | undefined {
  const documentUrl =
    fields.documentUrl === undefined ? undefined : scrubUrl(fields.documentUrl);
  if (documentUrl === undefined) return undefined;
  const sourceFile =
    fields.sourceFile === undefined ? undefined : scrubUrl(fields.sourceFile);
  const { line, column, disposition } = fields;
  return {
    documentUrl,
    directive: directiveName(fields.directive),
    blocked: scrubBlocked(fields.blocked),
    ...(sourceFile !== undefined && { sourceFile }),
    ...(line !== undefined && { line }),
    ...(column !== undefined && { column }),
    ...((disposition === "enforce" || disposition === "report") && {
      disposition,
    }),
  };
}

function mediaType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

function legacyViolations(json: unknown): CspViolation[] | undefined {
  const parsed = legacyBody.safeParse(json);
  if (!parsed.success) return undefined;
  const report = parsed.data["csp-report"];
  const found = violation({
    documentUrl: report["document-uri"],
    directive: report["effective-directive"] ?? report["violated-directive"],
    blocked: report["blocked-uri"],
    sourceFile: report["source-file"],
    line: report["line-number"],
    column: report["column-number"],
    disposition: report.disposition,
  });
  return found ? [found] : [];
}

function batchViolations(json: unknown): CspViolation[] | undefined {
  const parsed = reportingBatch.safeParse(json);
  if (!parsed.success) return undefined;
  return parsed.data
    .flatMap(({ type, body }) => {
      if (type !== "csp-violation" || body === undefined) return [];
      const found = violation({
        documentUrl: body.documentURL,
        directive: body.effectiveDirective,
        blocked: body.blockedURL,
        sourceFile: body.sourceFile,
        line: body.lineNumber,
        column: body.columnNumber,
        disposition: body.disposition,
      });
      return found ? [found] : [];
    })
    .slice(0, CSP_REPORT_MAX_VIOLATIONS);
}

const READERS = new Map<string, (json: unknown) => CspViolation[] | undefined>([
  ["application/csp-report", legacyViolations],
  ["application/reports+json", batchViolations],
]);

/** Parses and scrubs one request body sent to the report endpoint. */
export function parseCspReport(
  contentType: string | null,
  body: string
): CspReportResult {
  const read = READERS.get(mediaType(contentType));
  if (read === undefined) return { ok: false, status: 415 };
  if (new TextEncoder().encode(body).length > CSP_REPORT_MAX_BYTES) {
    return { ok: false, status: 413 };
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, status: 400 };
  }
  const violations = read(json);
  return violations === undefined
    ? { ok: false, status: 400 }
    : { ok: true, violations };
}

/**
 * How many violations one server instance logs per window, across every
 * sender: a flood of reports can't fill the logs, and no IP is kept to
 * limit per sender. Reports over the budget are dropped.
 */
export function createReportBudget({
  limit,
  windowMs,
  now,
}: {
  limit: number;
  windowMs: number;
  now: () => number;
}) {
  let windowStart = now();
  let used = 0;
  return {
    /** Takes up to `count` from this window; returns how many it got. */
    take(count: number): number {
      const at = now();
      if (at - windowStart >= windowMs) {
        windowStart = at;
        used = 0;
      }
      const granted = Math.max(0, Math.min(count, limit - used));
      used += granted;
      return granted;
    },
  };
}
