import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false });

try {
  console.log("Running migrations...");
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  console.log("Migrations complete.");
  await client.end();
} catch (error) {
  console.error("Migration failed:", error);
  await client.end({ timeout: 5 });
  process.exit(1);
}
