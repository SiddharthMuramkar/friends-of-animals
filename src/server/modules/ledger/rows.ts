import { asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { ledgerAccount, ledgerLine } from "../../db/schema";

export function postingLines(db: AppDb, postingId: string) {
  return db
    .select({
      lineNo: ledgerLine.lineNo,
      accountCode: ledgerAccount.code,
      accountName: ledgerAccount.name,
      debitMinor: ledgerLine.debitMinor,
      creditMinor: ledgerLine.creditMinor,
      currency: ledgerLine.currency,
      memo: ledgerLine.memo,
    })
    .from(ledgerLine)
    .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerLine.accountId))
    .where(eq(ledgerLine.postingId, postingId))
    .orderBy(asc(ledgerLine.lineNo));
}
