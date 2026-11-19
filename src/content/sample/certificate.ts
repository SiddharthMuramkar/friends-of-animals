/** The sample participation certificate and its number format. */
export const CERTIFICATE_NUMBER = /^FOA-C-\d{2}-[0-9A-HJKMNP-TV-Z]{10}$/;

export const SAMPLE_CERTIFICATE = {
  number: "FOA-C-27-9XQ4M2T7KD",
  competitionCode: "NEIGH27",
  discipline: "DRAWING",
  ageGroup: { label: "Group B", minAge: 9, maxAge: 12 },
  issuedOn: "2027-03-15",
} as const;
