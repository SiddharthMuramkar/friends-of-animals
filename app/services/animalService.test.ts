import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimalStatus } from "~/db/schema";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import {
  createAnimal,
  deleteAnimal,
  getAnimal,
  listAnimals,
  setAnimalPhoto,
  updateAnimal,
} from "./animalService";

let testDb: TestDb;
let base: Awaited<ReturnType<typeof seedBaseData>>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

beforeEach(async () => {
  testDb = await createTestDb();
  base = await seedBaseData(testDb);
});

describe("listAnimals", () => {
  it("returns all animals, newest first", async () => {
    const fresh = await createAnimal({ name: "Newbie", species: "dog" });
    const list = await listAnimals();
    expect(list.map((a) => a.id)).toEqual([fresh.id, base.cat.id, base.dog.id]);
  });

  it("filters by status", async () => {
    const pending = await listAnimals({ status: AnimalStatus.Pending });
    expect(pending.map((a) => a.name)).toEqual(["Whiskers"]);
  });

  it("respects limit", async () => {
    expect(await listAnimals({ limit: 1 })).toHaveLength(1);
  });
});

describe("getAnimal", () => {
  it("returns the animal or null", async () => {
    expect((await getAnimal(base.dog.id))?.name).toBe("Rex");
    expect(await getAnimal(9999)).toBeNull();
  });
});

describe("createAnimal", () => {
  it("inserts with defaults", async () => {
    const animal = await createAnimal({
      name: "Mochi",
      species: "rabbit",
      ageMonths: 12,
    });
    expect(animal.id).toBeGreaterThan(0);
    expect(animal.status).toBe(AnimalStatus.Available);
    expect(animal.photoKey).toBeNull();
  });
});

describe("updateAnimal", () => {
  it("updates fields and bumps updatedAt", async () => {
    const updated = await updateAnimal(base.dog.id, {
      status: AnimalStatus.Adopted,
      breed: "Beagle",
    });
    expect(updated?.status).toBe(AnimalStatus.Adopted);
    expect(updated?.breed).toBe("Beagle");
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      base.dog.updatedAt.getTime(),
    );
  });

  it("returns null for a missing animal", async () => {
    expect(await updateAnimal(9999, { name: "Ghost" })).toBeNull();
  });
});

describe("setAnimalPhoto", () => {
  it("stores and clears the photo key", async () => {
    const withPhoto = await setAnimalPhoto(base.cat.id, "animals/abc.png");
    expect(withPhoto?.photoKey).toBe("animals/abc.png");
    const cleared = await setAnimalPhoto(base.cat.id, null);
    expect(cleared?.photoKey).toBeNull();
  });
});

describe("deleteAnimal", () => {
  it("removes the animal", async () => {
    await deleteAnimal(base.dog.id);
    expect(await getAnimal(base.dog.id)).toBeNull();
  });
});
