import { expect, type Page, type Response } from "@playwright/test";

const POLICY_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
];

/**
 * Starts recording every Content-Security-Policy violation on `page`, from
 * now on and across navigations: `securitypolicyviolation` events, enforced
 * and report-only alike, and the console messages browsers log for them.
 * Call it before the first `goto`. Returns the live list.
 */
export async function recordCspViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeBinding(
    "__recordCspViolation",
    (_source, violation: string) => {
      violations.push(violation);
    }
  );
  // Playwright's init scripts run outside the page's policy.
  await page.addInitScript(() => {
    document.addEventListener(
      "securitypolicyviolation",
      (event) => {
        const record = (
          window as unknown as {
            __recordCspViolation: (violation: string) => void;
          }
        ).__recordCspViolation;
        record(
          `${event.disposition} ${event.effectiveDirective} blocked ` +
            `${event.blockedURI || "inline"} on ${location.pathname} ` +
            `(${event.sourceFile}:${event.lineNumber})`
        );
      },
      true
    );
  });
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) {
      violations.push(`console: ${message.text()}`);
    }
  });
  return violations;
}

/** The response's CSP headers, as [name, value] pairs. */
async function policyHeaders(response: Response) {
  return (await response.headersArray())
    .filter(({ name }) => POLICY_HEADERS.includes(name.toLowerCase()))
    .map(({ name, value }) => [name.toLowerCase(), value] as const);
}

/** The one CSP the response carries (enforced or report-only). */
export async function onlyPolicy(
  response: Response | null,
  label: string
): Promise<string> {
  expect(response, `response for ${label}`).not.toBeNull();
  const policies = await policyHeaders(response!);
  expect(policies.length, `CSP headers on ${label}`).toBe(1);
  return policies[0]![1];
}

/** The nonce in a policy's script-src, if it has one. */
export function nonceOf(policy: string): string | undefined {
  return /script-src [^;]*'nonce-([^']+)'/.exec(policy)?.[1];
}

/**
 * Every <script> start tag in `html` with its body, so the test can check
 * what the server sent (browsers hide `nonce` from the DOM).
 */
export function scriptsIn(html: string) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(
    ([, attributes = "", body = ""]) => ({ attributes, body })
  );
}
