// The origin of a Cloudflare R2 account's S3 API: where the storage adapter
// (src/server/ports/storage-r2.ts) sends requests, and where browsers PUT
// uploads and fetch files through presigned URLs, so the CSP allows it
// (./csp-sources.ts). Plain Node, no `@/` imports: next.config.ts loads it.

const ACCOUNT_ID = /^[0-9a-f]{32}$/;

/** `https://<account>.r2.cloudflarestorage.com`, or null for a bad id. */
export function r2Origin(accountId: string): string | null {
  return ACCOUNT_ID.test(accountId)
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : null;
}
