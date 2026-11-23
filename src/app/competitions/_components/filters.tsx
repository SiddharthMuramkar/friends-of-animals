import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { DISCIPLINES } from "@/components/competitions/model";
import { cn } from "@/lib/utils";

import { AGE_BANDS } from "../_lib/view";
import styles from "./filters.module.css";

const STATUSES = ["open", "upcoming", "inProgress", "results"] as const;

function Choice({
  name,
  value,
  label,
  checked,
}: {
  name: string;
  value: string;
  label: string;
  checked?: boolean;
}) {
  return (
    <label className="relative inline-flex min-h-11 max-w-full cursor-pointer items-center rounded-full border-2 border-border-strong bg-surface px-4 text-sm font-semibold wrap-anywhere text-ink transition-colors duration-150 hover:border-ink has-checked:border-pink-700 has-checked:bg-pink-700 has-checked:text-white dark:has-checked:border-pink-300 dark:has-checked:bg-pink-300 dark:has-checked:text-neutral-950">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={checked}
        className="absolute inset-0 cursor-pointer appearance-none rounded-full"
      />
      {label}
    </label>
  );
}

function Group({
  legend,
  children,
  className,
}: {
  legend: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-2 font-display text-lead font-semibold text-ink">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

/**
 * Status, discipline and age filters as radio chips. The CSS module hides
 * non-matching `.card` items (cardClass) inside the same root: no JS, no
 * searchParams, so the page prerenders.
 */
export async function CompetitionFilters({
  children,
  className,
}: {
  /** The list: each item needs `cardClass` and the filterTokens data-*. */
  children: ReactNode;
  className?: string;
}) {
  const t = await getTranslations("competitions.filters");
  const ts = await getTranslations("sample");
  return (
    <div className={cn(styles.root, className)}>
      <form
        aria-label={t("label")}
        className="grid grid-cols-1 gap-6 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6 lg:grid-cols-2"
      >
        <Group legend={t("status")}>
          <Choice name="status" value="all" label={t("all")} checked />
          {STATUSES.map((s) => (
            <Choice key={s} name="status" value={s} label={ts(`status.${s}`)} />
          ))}
        </Group>
        <Group legend={t("age")}>
          <Choice name="age" value="all" label={t("all")} checked />
          {AGE_BANDS.map((b) => (
            <Choice
              key={b.key}
              name="age"
              value={b.key}
              label={t(`bands.${b.key}`)}
            />
          ))}
        </Group>
        <Group legend={t("discipline")} className="lg:col-span-2">
          <Choice name="discipline" value="all" label={t("all")} checked />
          {DISCIPLINES.map((d) => (
            <Choice
              key={d}
              name="discipline"
              value={d}
              label={ts(`discipline.${d}`)}
            />
          ))}
        </Group>
        <p className="text-sm text-ink-muted lg:col-span-2">{t("note")}</p>
      </form>
      {children}
    </div>
  );
}

export const cardClass = styles.card;
