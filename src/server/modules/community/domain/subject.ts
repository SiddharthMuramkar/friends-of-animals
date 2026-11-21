// Whose journey a membership, milestone or timeline entry belongs to.
// A person with a login is a user; a child under 13 has only a participant
// profile (#81), and results always name the profile that took part. So a
// subject is one or the other, never both: the tables carry two nullable
// columns with a CHECK that exactly one is set, and reads gather every key
// that belongs to the person.
//
// Pure: no imports, so the schema file (plain Node) can use it.

export type Subject =
  | { kind: "user"; userId: string }
  | { kind: "profile"; profileId: string };

/** The subject as one string: `user:<id>` or `profile:<id>`. */
export function subjectKey(subject: Subject): string {
  return subject.kind === "user"
    ? `user:${subject.userId}`
    : `profile:${subject.profileId}`;
}
