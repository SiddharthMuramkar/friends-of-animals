// Who gives (#106). A donor is a person, a company or a CSR partner; for
// the last two the name on the donation is the contact person's and the
// organisation's name is kept beside it. Corporate and CSR donors choose
// whether their organisation's name may be shown in public (the donor wall,
// the transparency page); their own receipt always carries it. Pure.
//
// Loads under plain Node (drizzle-kit reads the schema that imports it): no
// imports at all.

export const DONOR_TYPES = ["individual", "corporate", "csr"] as const;

export type DonorType = (typeof DONOR_TYPES)[number];

/** Corporate and CSR donors give as an organisation. */
export function givesAsOrganisation(type: DonorType): boolean {
  return type !== "individual";
}

/**
 * The name the donor wall shows when the donor asked to appear on it but
 * typed no name of their own: a person's first name and last initial
 * ("Asha Rao" is "Asha R."), or the organisation's name when it chose
 * disclosure. An organisation that didn't choose disclosure gets none, so
 * the wall shows it without a name.
 */
export function defaultWallName(donor: {
  type: DonorType;
  name: string;
  organisationName?: string | undefined;
  discloseOrganisation?: boolean | undefined;
}): string | null {
  if (givesAsOrganisation(donor.type)) {
    return donor.discloseOrganisation === true && donor.organisationName
      ? donor.organisationName
      : null;
  }
  const parts = donor.name.trim().split(/\s+/).filter(Boolean);
  const [first] = parts;
  if (!first) return null;
  const last = parts.length > 1 ? parts.at(-1) : undefined;
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}
