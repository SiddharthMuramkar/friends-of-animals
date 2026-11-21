// The audit module (#59): the append-only log and its search. Other modules
// write entries with `recordAudit` inside their own transactions; reading
// joins `as(actor)` through `auditUseCases`.

import type { UseCaseContext } from "../use-cases";
import { searchAuditLog, type SearchAuditLogInput } from "./search";

export { recordAudit, type AuditEntry } from "./record";
export type {
  AuditEntryView,
  SearchAuditLogInput,
  SearchAuditLogResult,
} from "./search";

export const auditUseCases = (ctx: UseCaseContext) => ({
  searchAuditLog: (input: SearchAuditLogInput) => searchAuditLog(ctx, input),
});
