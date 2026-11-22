import { BadgeCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Placeholder } from "@/components/site/placeholder";
import { WithOrgFacts } from "@/components/site/with-org-facts";
import { isFactShown } from "@/lib/site";
import { cn } from "@/lib/utils";

const POINTS = ["sources", "quotes", "numbers", "noLink"] as const;

/** "How we check facts": the promise behind every story. */
export async function FactChecks({ className }: { className?: string }) {
  const t = await getTranslations("stories.checks");
  return (
    <aside
      aria-labelledby="fact-checks"
      className={cn(
        "rounded-3xl border-2 border-border bg-surface p-6 shadow-warm sm:p-8",
        className
      )}
    >
      <h2
        id="fact-checks"
        className="flex items-center gap-3 font-display text-h4 leading-tight"
      >
        <BadgeCheck
          aria-hidden="true"
          className="size-7 text-green-700 dark:text-green-400"
        />
        {t("title")}
      </h2>
      <ul className="mt-4 space-y-2.5">
        {POINTS.map((p) => (
          <li key={p} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-2 size-2.5 shrink-0 rounded-[22%] bg-yellow-500"
            />
            <span className="min-w-0">{t(`points.${p}`)}</span>
          </li>
        ))}
      </ul>
      {/* Production drops the line until FOA's email is confirmed. */}
      <WithOrgFacts>
        {({ email }) =>
          isFactShown(email) ? (
            <p className="mt-5 flex flex-wrap items-center gap-2 text-ink-muted">
              {t("mistake")}{" "}
              <Placeholder fact={email}>
                {(address) => (
                  <a
                    href={`mailto:${address}`}
                    className="text-link underline underline-offset-2"
                  >
                    {address}
                  </a>
                )}
              </Placeholder>
            </p>
          ) : null
        }
      </WithOrgFacts>
    </aside>
  );
}
