"use client";

import { useState, type ReactNode } from "react";

type Month = {
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
}: {
  id: string;
  months: readonly Month[];
  initialMonth: number;
  picker: ReactNode;
  className: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const selected = months[month - 1]!;

  return (
    <article id={id} aria-labelledby={selected.titleId} className={className}>
      <div
        onChange={(event) => {
          if (event.target instanceof HTMLInputElement) {
            setMonth(Number(event.target.value));
          }
        }}
      >
        {picker}
      </div>
      <output className="sr-only">{selected.title}</output>
      <div className="mt-8 grid min-w-0 grid-cols-1 items-start gap-8 @min-[48rem]/seasonal:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @min-[48rem]/seasonal:gap-10">
        <div key={month} className="min-w-0">
          {selected.copy}
        </div>
        <div className="min-w-0">{selected.media}</div>
      </div>
    </article>
  );
}
