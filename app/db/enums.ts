// Plain TS enums shared by server and client code. Keep this file free of
// drizzle (or any server-only) imports.

export enum UserRole {
  Volunteer = "volunteer",
  Staff = "staff",
  Admin = "admin",
}

export enum AnimalStatus {
  Available = "available",
  Pending = "pending",
  Adopted = "adopted",
}
