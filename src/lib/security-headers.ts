/**
 * The SPEC §13.1 response headers other than the CSP, sent on every route
 * (HTML and static assets) by `headers()` in next.config.ts. That applies on
 * Vercel and in the standalone server alike. The CSP is tracked in #15; until
 * it adds `frame-ancestors 'none'`, X-Frame-Options blocks framing.
 *
 * Keep this file free of Next.js and server-only imports: next.config.ts
 * loads it under plain Node.
 */

export type SecurityHeader = { key: string; value: string };

/**
 * HSTS for production covers every subdomain for two years. Other
 * deployments (staging, previews, local) skip includeSubDomains, so a
 * subdomain that is not yet HTTPS keeps working. Never `preload`: submit to
 * hstspreload.org only once the production domain is final.
 */
export function strictTransportSecurity(appEnv: string | undefined): string {
  return appEnv === "production"
    ? "max-age=63072000; includeSubDomains"
    : "max-age=31536000";
}

/** The headers for one deployment, from its APP_ENV. */
export function securityHeaders(appEnv: string | undefined): SecurityHeader[] {
  return [
    {
      key: "Strict-Transport-Security",
      value: strictTransportSecurity(appEnv),
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Razorpay will add payment=(self "https://checkout.razorpay.com").
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
