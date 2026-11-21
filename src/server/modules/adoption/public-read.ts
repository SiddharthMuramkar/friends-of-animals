import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export type DirectoryVerifiedSql = (directoryListingId: AnyPgColumn) => SQL;
