// The cache tag on a purpose's current consent document. The cached read
// (./cached.ts) tags under it; a publish's Server Action passes it to
// `updateTag`, whether #64's screen or the CMS (#111) published.
//
// Loads under plain Node: no imports.

export function consentDocumentTag(purpose: string): string {
  return `consent-document:${purpose}`;
}
