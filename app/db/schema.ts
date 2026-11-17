import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { AnimalStatus, UserRole } from "./enums";

// Enums live in ./enums so client components can import them without
// pulling drizzle into the browser bundle.
export { AnimalStatus, UserRole };

export const userRole = pgEnum("user_role", [
  UserRole.Volunteer,
  UserRole.Staff,
  UserRole.Admin,
]);

export const animalStatus = pgEnum("animal_status", [
  AnimalStatus.Available,
  AnimalStatus.Pending,
  AnimalStatus.Adopted,
]);

// ─── Tables ───

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull().default(UserRole.Volunteer),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const animals = pgTable("animals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  species: text("species").notNull(), // e.g. "dog", "cat"
  breed: text("breed"),
  ageMonths: integer("age_months"),
  sex: text("sex"),
  status: animalStatus("status").notNull().default(AnimalStatus.Available),
  description: text("description"),
  photoKey: text("photo_key"), // object-storage key, not a URL
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ─── Types ───

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Animal = typeof animals.$inferSelect;
export type NewAnimal = typeof animals.$inferInsert;
