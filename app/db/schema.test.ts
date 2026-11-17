import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { AnimalStatus, UserRole, animals } from "./schema";

describe("schema", () => {
  it("inserts and reads back an animal with defaults applied", async () => {
    const testDb = await createTestDb();

    const [created] = await testDb
      .insert(animals)
      .values({ name: "Biscuit", species: "dog", ageMonths: 18 })
      .returning();

    const [found] = await testDb
      .select()
      .from(animals)
      .where(eq(animals.id, created.id));

    expect(found.name).toBe("Biscuit");
    expect(found.species).toBe("dog");
    expect(found.ageMonths).toBe(18);
    expect(found.status).toBe(AnimalStatus.Available);
    expect(found.photoKey).toBeNull();
    expect(found.createdAt).toBeInstanceOf(Date);
    expect(found.updatedAt).toBeInstanceOf(Date);
  });

  it("seeds base data", async () => {
    const testDb = await createTestDb();
    const { user, dog, cat } = await seedBaseData(testDb);

    expect(user.role).toBe(UserRole.Staff);
    expect(dog.species).toBe("dog");
    expect(cat.status).toBe(AnimalStatus.Pending);
  });
});
