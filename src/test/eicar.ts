// The EICAR test file: 68 harmless bytes that every antivirus, ClamAV
// included, reports as malware (https://www.eicar.org/download-anti-malware-testfile/).
// It is built here from two halves, so no file in the repo holds the whole
// string for a local antivirus to quarantine. Tests only.

const FIRST_HALF = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$";
const SECOND_HALF = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export const EICAR_TEST_BYTES: Uint8Array = new TextEncoder().encode(
  FIRST_HALF + SECOND_HALF
);

/** What ClamAV calls it. */
export const EICAR_SIGNATURE = "Win.Test.EICAR_HDB-1";

/** Whether `bytes` holds the EICAR test file anywhere. */
export function containsEicar(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).includes(EICAR_TEST_BYTES);
}
