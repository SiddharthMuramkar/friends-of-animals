// TODO(auth): remove this banner once admin routes are protected.
export function AdminBanner() {
  return (
    <div
      role="alert"
      className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      <strong>Admin is unprotected</strong> — add auth before deploying.
    </div>
  );
}
