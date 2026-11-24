"use client";

import { Check } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Month = {
  number: number;
  name: string;
  initial: string;
  title: string;
  titleId: string;
  copy: ReactNode;
  media: ReactNode;
};

export function SeasonalCalendar({
  months,
  initialMonth,
  legend,
  className,
}: {
  months: readonly Month[];
  initialMonth: number;
  legend: string;
  className: string;
}) {
  const group = useId();
  const [month, setMonth] = useState(initialMonth);
  const selected = months[month - 1]!;

  return (
    <article
      aria-labelledby={selected.titleId}
      className={cn(
        className,
        "items-start lg:grid-rows-[auto_1fr] lg:gap-y-6"
      )}
    >
      <div className="@container/seasonal-month rounded-3xl bg-section-teal p-[min(1.5rem,8%)] sm:p-8 lg:col-start-2 lg:row-start-1">
        <p className="font-display text-h2 leading-none font-bold wrap-anywhere text-(--section-heading)">
          {selected.name}
        </p>
        <fieldset className="mt-6 grid min-w-0 grid-cols-3 gap-2 @min-[13.5rem]/seasonal-month:grid-cols-4 @min-[20.5rem]/seasonal-month:grid-cols-6">
          <legend className="sr-only">{legend}</legend>
          {months.map((option) => (
            <label
              key={option.number}
              className="relative grid aspect-square min-h-12 max-h-16 cursor-pointer place-items-center rounded-[22%] bg-surface font-display text-sm font-bold text-ink-muted hover:ring-2 hover:ring-teal-700 has-checked:bg-teal-700 has-checked:text-white has-checked:shadow-warm has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input
                name={group}
                type="radio"
                value={option.number}
                checked={month === option.number}
                onChange={() => setMonth(option.number)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
              <span className="sr-only">{option.name}</span>
              <span aria-hidden="true">{option.initial}</span>
              {month === option.number && (
                <Check
                  aria-hidden="true"
                  className="absolute top-1 right-1 size-3"
                />
              )}
            </label>
          ))}
        </fieldset>
      </div>
      <output className="sr-only">{selected.title}</output>
      <div
        key={month}
        className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1"
      >
        {selected.copy}
      </div>
      <div className="min-w-0 lg:col-start-2 lg:row-start-2">
        {selected.media}
      </div>
    </article>
  );
}
