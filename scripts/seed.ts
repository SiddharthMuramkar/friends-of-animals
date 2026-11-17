import { sql } from "drizzle-orm";
import { closeDb, db } from "../app/db";
import {
  AnimalStatus,
  UserRole,
  animals,
  users,
  type NewAnimal,
} from "../app/db/schema";

const sampleAnimals: NewAnimal[] = [
  {
    name: "Biscuit",
    species: "dog",
    breed: "Labrador mix",
    ageMonths: 18,
    sex: "male",
    status: AnimalStatus.Available,
    description: "Goofy, food-motivated, and great with kids.",
  },
  {
    name: "Luna",
    species: "cat",
    breed: "Domestic shorthair",
    ageMonths: 36,
    sex: "female",
    status: AnimalStatus.Available,
    description: "Calm lap cat who loves sunny windowsills.",
  },
  {
    name: "Rocket",
    species: "dog",
    breed: "Border collie",
    ageMonths: 8,
    sex: "male",
    status: AnimalStatus.Pending,
    description: "High-energy pup looking for an active home.",
  },
  {
    name: "Mochi",
    species: "rabbit",
    breed: "Holland lop",
    ageMonths: 12,
    sex: "female",
    status: AnimalStatus.Available,
    description: "Curious and gentle; litter trained.",
  },
  {
    name: "Pepper",
    species: "cat",
    breed: "Tuxedo",
    ageMonths: 4,
    sex: "male",
    status: AnimalStatus.Available,
    description: "Playful kitten, gets along with other cats.",
  },
  {
    name: "Duke",
    species: "dog",
    breed: "Greyhound",
    ageMonths: 72,
    sex: "male",
    status: AnimalStatus.Adopted,
    description: "Retired racer turned professional couch potato.",
  },
];

async function main() {
  console.log("Seeding database...");

  await db.execute(sql`TRUNCATE TABLE animals, users RESTART IDENTITY CASCADE`);

  const [admin] = await db
    .insert(users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      role: UserRole.Admin,
    })
    .returning();
  console.log(`Created admin user: ${admin.email}`);

  const inserted = await db.insert(animals).values(sampleAnimals).returning();
  console.log(`Created ${inserted.length} animals.`);

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
