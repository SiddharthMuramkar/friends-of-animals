/** The competition's fees, prizes and terms page. */
export function competitionTermsPath(competitionId: string): string {
  return `/admin/competitions/${encodeURIComponent(competitionId)}/terms`;
}
