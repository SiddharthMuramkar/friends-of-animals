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
  id,
  months,
  initialMonth,
  picker,
  className,
  panelClassName,
}: {
  id: string;
  months: readonly Month[];
  initialMonth: number;
  picker: ReactNode;
  className: string;
  panelClassName: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const selected = months[month - 1]!;

  return (
    <article id={id} aria-labelledby={selected.titleId} className={className}>
      <div className={panelClassName}>
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
