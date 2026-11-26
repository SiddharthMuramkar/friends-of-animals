// Which entries an FOA round's pool admits (#95). Every entry must be
// FOA-verified. A round that judges the physical artwork also needs the
// artwork to pass the "physically ready for judging" check; a round that
// judges the digital work doesn't look at the artwork at all.
//
// Pure: the caller loads both facts set-wise for the competition. Loads
// under plain Node (seed script).

export type PoolAdmissionFacts = {
  judgesPhysical: boolean;
  foaVerified: boolean;
  physicallyReady: boolean;
};

export type PoolRefusal =
  | "not_foa_verified"
  | "not_physically_ready"
  | "not_source_finalist";

export type PoolAdmission =
  | { admitted: true }
  | { admitted: false; reason: PoolRefusal };

export function decidePoolAdmission(facts: PoolAdmissionFacts): PoolAdmission {
  if (!facts.foaVerified)
    return { admitted: false, reason: "not_foa_verified" };
  if (facts.judgesPhysical && !facts.physicallyReady) {
    return { admitted: false, reason: "not_physically_ready" };
  }
  return { admitted: true };
}
