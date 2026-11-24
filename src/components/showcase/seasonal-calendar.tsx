"use client";

import { useState, type ReactNode } from "react";

type Month = {
  name: string;
  title: string;
  titleId: string;
  copy: ReactNode;
  media: ReactNode;
};

export function SeasonalCalendar({
  months,
  initialMonth,
  picker,
  className,
}: {
  months: readonly Month[];
  initialMonth: number;
  picker: ReactNode;
  className: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const selected = months[month - 1]!;

  return (
    <article aria-labelledby={selected.titleId} className={className}>
      <div className="@container/seasonal-month rounded-3xl bg-section-teal p-[min(1.5rem,8%)] sm:p-8 lg:col-start-2 lg:row-start-1">
        <p className="font-display text-h2 leading-none font-bold wrap-anywhere text-(--section-heading)">
          {selected.name}
        </p>
        <div
          onChange={(event) => {
            if (event.target instanceof HTMLInputElement) {
              setMonth(Number(event.target.value));
            }
          }}
        >
          {picker}
        </div>
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
