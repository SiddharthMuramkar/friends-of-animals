"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Month = {
  name: string;
  title: string;
  titleId: string;
  copy: ReactNode;
  media: ReactNode;
};

function monthValue(input: HTMLInputElement | null | undefined, count: number) {
  const value = Number(input?.value);
  return Number.isInteger(value) && value >= 1 && value <= count ? value : null;
}

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
  const pickerRef = useRef<HTMLDivElement>(null);
  const selected = months[month - 1]!;

  // The native radios work before hydration on a slow connection. React
  // preserves their checked state without necessarily firing a change
  // event, so pick up any early selection when the calendar hydrates.
  useEffect(() => {
    const picked = monthValue(
      pickerRef.current?.querySelector<HTMLInputElement>(
        'input[type="radio"]:checked'
      ),
      months.length
    );
    if (picked !== null) setMonth(picked);
  }, [months.length]);

  return (
    <article id={id} aria-labelledby={selected.titleId} className={className}>
      <div className={panelClassName}>
        <p className="font-display text-h2 leading-none font-bold wrap-anywhere text-(--section-heading)">
          {selected.name}
        </p>
        <div
          ref={pickerRef}
          onChange={(event) => {
            if (event.target instanceof HTMLInputElement) {
              const picked = monthValue(event.target, months.length);
              if (picked !== null) setMonth(picked);
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
