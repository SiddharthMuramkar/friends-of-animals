import { desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { animals, type AnimalStatus, type NewAnimal } from "~/db/schema";

export type AnimalInput = Omit<NewAnimal, "id" | "createdAt" | "updatedAt">;

export async function listAnimals(opts: { status?: AnimalStatus; limit?: number } = {}) {
  const query = db
    .select()
    .from(animals)
    .where(opts.status ? eq(animals.status, opts.status) : undefined)
    .orderBy(desc(animals.createdAt), desc(animals.id));
  return opts.limit ? query.limit(opts.limit) : query;
}

export async function getAnimal(id: number) {
  const [animal] = await db.select().from(animals).where(eq(animals.id, id));
  return animal ?? null;
}

export async function createAnimal(data: AnimalInput) {
  const [animal] = await db.insert(animals).values(data).returning();
  return animal;
}

export async function updateAnimal(id: number, data: Partial<AnimalInput>) {
  const [animal] = await db
    .update(animals)
    .set(data)
    .where(eq(animals.id, id))
    .returning();
  return animal ?? null;
}

export async function setAnimalPhoto(id: number, photoKey: string | null) {
  return updateAnimal(id, { photoKey });
}

export async function deleteAnimal(id: number) {
  const [animal] = await db.delete(animals).where(eq(animals.id, id)).returning();
  return animal ?? null;
}
