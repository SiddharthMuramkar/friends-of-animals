// The off-site copy of production files (#68): each night, new and changed
// objects in R2's production buckets are copied to one Backblaze B2 bucket,
// and a copy outlives its object by the retention window, so a file deleted
// by mistake can still be restored.

export type { AppEnv, OffsiteConfig } from "./config";
export {
  runOffsiteCopy,
  type OffsiteDeps,
  type OffsiteRunReport,
  type OffsiteTotals,
} from "./run-copy";
export {
  restoreOffsiteFile,
  type RestoreDeps,
  type RestoreResult,
} from "./restore";
export {
  OffsiteCopyIncompleteError,
  OffsiteMassDeletionWarning,
} from "./errors";
