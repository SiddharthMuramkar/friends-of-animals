// The EICAR test file, for tests: 68 harmless bytes that every antivirus,
// ClamAV included, reports as malware. The bytes and the check are the
// local scanner's (src/server/ports/malware-scanner-local.ts), so the repo
// holds one copy, built from two halves there.

export {
  containsEicar,
  EICAR_TEST_BYTES,
} from "@/server/ports/malware-scanner-local";

/** What ClamAV calls it. */
export const EICAR_SIGNATURE = "Win.Test.EICAR_HDB-1";
