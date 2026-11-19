import { getTranslations } from "next-intl/server";

import { QuickExit } from "./quick-exit";

const HINT_ID = "quick-exit-hint";

/**
 * /safeguarding's sticky Quick exit bar. It renders through the root
 * layout's @exit slot, first in <body> so Quick exit is the first thing Tab
 * reaches (#48); `order-1` shows it under the header, above the content
 * (`order-2`), and it stays on screen over the footer too (#52).
 * `data-quick-exit-bar` adds its height to the scroll padding (globals.css).
 */
export async function QuickExitBar() {
  const t = await getTranslations("legal.safeguarding");
  return (
    <aside
      aria-label={t("quickExit")}
      data-quick-exit-bar
      className="sticky top-(--header-height) z-30 order-1 border-b-2 border-border bg-surface"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <p
          id={HINT_ID}
          className="sr-only text-sm text-ink-muted sm:not-sr-only"
        >
          {t("quickExitHint")}
        </p>
        <QuickExit label={t("quickExit")} hintId={HINT_ID} />
      </div>
    </aside>
  );
}
