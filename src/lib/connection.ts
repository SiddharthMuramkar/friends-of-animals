/**
 * The parts of the Network Information API (`navigator.connection`) the
 * site reads. Only Chromium browsers expose it; elsewhere it is undefined.
 */
export type ConnectionHints = {
  /** The visitor turned on data saver (often on prepaid plans). */
  saveData?: boolean;
  /** "slow-2g", "2g", "3g" or "4g", estimated from recent round trips. */
  effectiveType?: string;
};

/**
 * Whether links should skip prefetching: the visitor asked to save data,
 * or the connection is 2G-slow. Unknown connections prefetch as usual.
 */
export function shouldSkipPrefetch(
  connection: ConnectionHints | null | undefined
): boolean {
  if (!connection) return false;
  return (
    connection.saveData === true ||
    connection.effectiveType === "2g" ||
    connection.effectiveType === "slow-2g"
  );
}
